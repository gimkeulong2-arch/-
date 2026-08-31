const BASE = "https://www.koreabaseball.com";
const ENG = "https://eng.koreabaseball.com";

/* =========================
   기본 함수
========================= */

function decodeHtml(str = "") {
  return str
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) =>
      String.fromCharCode(Number(n))
    );
}

function text(html = "") {
  return decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

async function get(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
    },
  });

  if (!res.ok) {
    throw new Error(`KBO 요청 실패: ${res.status}`);
  }

  return await res.text();
}

function todayKST() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const obj = {};
  for (const p of parts) obj[p.type] = p.value;

  return `${obj.year}-${obj.month}-${obj.day}`;
}

function currentMonthKST() {
  return todayKST().slice(0, 7);
}

/* =========================
   일반 HTML 테이블
========================= */

function tables(html) {
  const result = [];

  const tableMatches =
    html.match(/<table\b[\s\S]*?<\/table>/gi) || [];

  for (const tableHtml of tableMatches) {
    const rows =
      tableHtml.match(/<tr\b[\s\S]*?<\/tr>/gi) || [];

    if (!rows.length) continue;

    let headers = [];
    const body = [];

    for (const row of rows) {
      const ths = [
        ...row.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi),
      ].map((m) => text(m[1]));

      const tds = [
        ...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi),
      ].map((m) => text(m[1]));

      if (ths.length && !headers.length) {
        headers = ths;
      } else if (tds.length) {
        body.push(tds);
      }
    }

    if (headers.length || body.length) {
      result.push({
        headers,
        rows: body,
      });
    }
  }

  return result;
}

/* =========================
   ★ 롯데 선수단 전용 파서
========================= */

function playerFromAnchor(anchorHtml) {
  const hrefMatch = anchorHtml.match(
    /href\s*=\s*["']([^"']+)["']/i
  );

  const href = hrefMatch ? decodeHtml(hrefMatch[1]) : "";

  const nameText = text(anchorHtml);

  /*
    예:
    김진욱(15)
    김진욱 (15)
  */
  const match = nameText.match(
    /^(.+?)\s*\(\s*(\d+)\s*\)$/
  );

  if (!match) return null;

  const name = match[1].trim();
  const number = match[2];

  if (!name) return null;

  let path = href;

  if (path.startsWith(BASE)) {
    path = path.slice(BASE.length);
  }

  return {
    name,
    number,
    path:
      /^\/Player\//i.test(path)
        ? path
        : "",
  };
}

function playersFromCell(cellHtml) {
  const players = [];

  const anchors = [
    ...cellHtml.matchAll(
      /<a\b[^>]*>[\s\S]*?<\/a>/gi
    ),
  ];

  for (const a of anchors) {
    const p = playerFromAnchor(a[0]);

    if (p) players.push(p);
  }

  /*
    KBO가 링크 구조를 바꿨을 경우를 위한
    텍스트 fallback
  */
  if (!players.length) {
    const raw = text(cellHtml);

    const matches = [
      ...raw.matchAll(
        /([가-힣A-Za-zÀ-ÿ·.\-\s]+?)\s*\(\s*(\d+)\s*\)/g
      ),
    ];

    for (const m of matches) {
      const name = m[1]
        .replace(/\s+/g, " ")
        .trim();

      if (!name) continue;

      players.push({
        name,
        number: m[2],
        path: "",
      });
    }
  }

  /*
    중복 제거
  */
  const seen = new Set();

  return players.filter((p) => {
    const key = `${p.name}-${p.number}`;

    if (seen.has(key)) return false;

    seen.add(key);
    return true;
  });
}

function lotteRoster(html) {
  /*
    KBO 전체 등록 현황의 각 행을 조사
  */
  const rows =
    html.match(/<tr\b[\s\S]*?<\/tr>/gi) || [];

  for (const row of rows) {
    const cells = [
      ...row.matchAll(
        /<td\b[^>]*>([\s\S]*?)<\/td>/gi
      ),
    ].map((m) => m[1]);

    /*
      정상 행:
      0 구단
      1 감독
      2 코치
      3 투수
      4 포수
      5 내야수
      6 외야수
    */
    if (cells.length < 7) continue;

    const teamName = text(cells[0]);

    /*
      '롯데' 또는 '롯데 44명' 등 대응
    */
    if (!teamName.includes("롯데")) continue;

    return {
      투수: playersFromCell(cells[3]),
      포수: playersFromCell(cells[4]),
      내야수: playersFromCell(cells[5]),
      외야수: playersFromCell(cells[6]),
    };
  }

  throw new Error(
    "KBO 페이지에서 롯데 선수단 행을 찾지 못했습니다."
  );
}

/* =========================
   경기 일정
========================= */

function scheduleRows(html) {
  const ts = tables(html);

  let best = null;

  for (const t of ts) {
    const joined =
      `${t.headers.join(" ")} ${t.rows
        .flat()
        .join(" ")}`;

    if (
      /DATE|TIME|구장|경기|GAME/i.test(joined) &&
      t.rows.length
    ) {
      if (!best || t.rows.length > best.rows.length) {
        best = t;
      }
    }
  }

  return {
    table: best,
  };
}

/* =========================
   오늘 경기 스코어보드
========================= */

function scoreboard(html) {
  const ts = tables(html);

  const games = [];

  for (const t of ts) {
    for (const row of t.rows) {
      const joined = row.join(" ");

      /*
        롯데 경기만 우선 반환
      */
      if (
        joined.includes("LOTTE") ||
        joined.includes("Lotte") ||
        joined.includes("롯데")
      ) {
        games.push(row);
      }
    }
  }

  return games;
}

/* =========================
   Netlify Function
========================= */

exports.handler = async (event) => {
  try {
    const q =
      event.queryStringParameters || {};

    const type = q.type || "standings";

    let payload = {
      updatedAt: new Date().toISOString(),
    };

    /* ---------- 오늘 경기 ---------- */

    if (type === "score") {
      const d = todayKST();

      const html = await get(
        `${ENG}/Schedule/Scoreboard.aspx?searchDate=${d}`
      );

      payload = {
        ...payload,
        date: d,
        games: scoreboard(html),
      };
    }

    /* ---------- 경기 일정 ---------- */

    else if (type === "schedule") {
      const ym = currentMonthKST();

      const html = await get(
        `${ENG}/Schedule/DailySchedule.aspx?searchDate=${ym}`
      );

      payload = {
        ...payload,
        month: ym,
        ...scheduleRows(html),
      };
    }

    /* ---------- 순위 ---------- */

    else if (type === "standings") {
      const html = await get(
        `${BASE}/Record/TeamRank/TeamRankDaily.aspx`
      );

      const ts = tables(html);

      const table =
        ts.find(
          (t) =>
            t.headers.some((h) =>
              h.includes("순위")
            ) &&
            t.headers.some((h) =>
              h.includes("팀명")
            )
        ) || null;

      payload = {
        ...payload,
        table,
      };
    }

    /* ---------- ★ 롯데 선수단 ---------- */

    else if (type === "roster") {
      const html = await get(
        `${BASE}/Player/RegisterAll.aspx`
      );

      const groups = lotteRoster(html);

      payload = {
        ...payload,
        team: "롯데",
        groups,
        counts: {
          투수: groups["투수"].length,
          포수: groups["포수"].length,
          내야수: groups["내야수"].length,
          외야수: groups["외야수"].length,
        },
      };
    }

    /* ---------- 선수 상세 ---------- */

    else if (type === "player") {
      let path = q.path || "";

      if (!path.startsWith("/")) {
        path = "/" + path;
      }

      if (!/^\/Player\//i.test(path)) {
        throw new Error(
          "잘못된 선수 주소입니다."
        );
      }

      const html = await get(BASE + path);

      payload = {
        ...payload,
        tables: tables(html)
          .filter((t) => t.rows.length)
          .slice(0, 8),
      };
    }

    else {
      throw new Error(
        "지원하지 않는 요청입니다."
      );
    }

    return {
      statusCode: 200,
      headers: {
        "content-type":
          "application/json; charset=utf-8",
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
      },
      body: JSON.stringify(payload),
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: {
        "content-type":
          "application/json; charset=utf-8",
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
      },
      body: JSON.stringify({
        error: e.message,
      }),
    };
  }
};
