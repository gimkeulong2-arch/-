const BASE = "https://www.koreabaseball.com";
const ENG = "https://eng.koreabaseball.com";

function decodeHtml(str = "") {
  return str
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function cleanText(html = "") {
  return decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  ).replace(/\s+/g, " ").trim();
}

async function get(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 Chrome/130 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8"
    }
  });

  if (!res.ok) {
    throw new Error(`KBO 요청 실패: ${res.status}`);
  }

  return await res.text();
}

function todayKST() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function currentMonthKST() {
  return todayKST().slice(0, 7);
}

function tables(html) {
  const result = [];

  const tableMatches =
    html.match(/<table\b[\s\S]*?<\/table>/gi) || [];

  for (const tableHtml of tableMatches) {
    const rows =
      tableHtml.match(/<tr\b[\s\S]*?<\/tr>/gi) || [];

    let headers = [];
    const body = [];

    for (const row of rows) {
      const ths = [
        ...row.matchAll(
          /<th\b[^>]*>([\s\S]*?)<\/th>/gi
        )
      ].map(m => cleanText(m[1]));

      const tds = [
        ...row.matchAll(
          /<td\b[^>]*>([\s\S]*?)<\/td>/gi
        )
      ].map(m => cleanText(m[1]));

      if (ths.length && !headers.length) {
        headers = ths;
      }

      if (tds.length) {
        body.push(tds);
      }
    }

    if (headers.length || body.length) {
      result.push({
        headers,
        rows: body
      });
    }
  }

  return result;
}

function normalizePlayerPath(href = "") {
  href = decodeHtml(href).trim();

  if (!href) return "";

  if (/^https?:\/\//i.test(href)) {
    try {
      const u = new URL(href);

      if (!/koreabaseball\.com$/i.test(u.hostname)) {
        return "";
      }

      return u.pathname + u.search;
    } catch (_) {
      return "";
    }
  }

  return href.startsWith("/")
    ? href
    : "/" + href.replace(/^\.?\//, "");
}

function extractPlayers(cellHtml) {
  const players = [];

  const anchors = [
    ...cellHtml.matchAll(
      /<a\b([^>]*)>([\s\S]*?)<\/a>/gi
    )
  ];

  for (const m of anchors) {
    const hrefMatch =
      m[1].match(
        /href\s*=\s*["']([^"']+)["']/i
      );

    const label =
      cleanText(m[2]);

    const pm =
      label.match(
        /^(.+?)\s*\(\s*(\d{1,3})\s*\)$/
      );

    if (!pm) continue;

    players.push({
      name: pm[1].trim(),
      number: pm[2],
      path: normalizePlayerPath(
        hrefMatch ? hrefMatch[1] : ""
      )
    });
  }

  if (!players.length) {
    const raw =
      cleanText(cellHtml);

    for (
      const m of raw.matchAll(
        /([가-힣A-Za-zÀ-ÿ·.\-]+)\s*\(\s*(\d{1,3})\s*\)/g
      )
    ) {
      players.push({
        name: m[1].trim(),
        number: m[2],
        path: ""
      });
    }
  }

  const seen = new Set();

  return players.filter(p => {
    const key =
      `${p.name}|${p.number}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function lotteRoster(html) {
  const tablesHtml =
    html.match(
      /<table\b[\s\S]*?<\/table>/gi
    ) || [];

  for (const tableHtml of tablesHtml) {
    const plain =
      cleanText(tableHtml);

    if (!plain.includes("롯데")) {
      continue;
    }

    const rows =
      tableHtml.match(
        /<tr\b[\s\S]*?<\/tr>/gi
      ) || [];

    for (const row of rows) {
      const cells = [
        ...row.matchAll(
          /<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/gi
        )
      ].map(m => m[2]);

      if (cells.length < 7) {
        continue;
      }

      if (
        !cleanText(cells[0]).includes("롯데")
      ) {
        continue;
      }

      return {
        "투수": extractPlayers(cells[3]),
        "포수": extractPlayers(cells[4]),
        "내야수": extractPlayers(cells[5]),
        "외야수": extractPlayers(cells[6])
      };
    }
  }

  throw new Error(
    "KBO 페이지에서 롯데 선수단 행을 찾지 못했습니다."
  );
}

function scheduleRows(html) {
  const ts = tables(html);

  let best = null;

  for (const t of ts) {
    const joined =
      `${t.headers.join(" ")} ${t.rows
        .flat()
        .join(" ")}`;

    if (
      /DATE|TIME|GAME|경기|구장/i.test(joined)
    ) {
      if (
        !best ||
        t.rows.length > best.rows.length
      ) {
        best = t;
      }
    }
  }

  const lotteRows =
    best
      ? best.rows.filter(
          r =>
            /LOTTE|Lotte|롯데/i.test(
              r.join(" ")
            )
        )
      : [];

  return {
    table: best,
    lotteRows
  };
}

function scoreboard(html) {
  const games = [];

  for (const t of tables(html)) {
    for (const row of t.rows) {
      if (
        /LOTTE|Lotte|롯데/i.test(
          row.join(" ")
        )
      ) {
        games.push(row);
      }
    }
  }

  return games;
}

function playerTables(html) {
  return tables(html)
    .filter(t => {
      if (!t.rows.length) {
        return false;
      }

      const joined =
        `${t.headers.join(" ")} ${t.rows
          .flat()
          .join(" ")}`;

      return (
        /타율|안타|홈런|타점|득점|ERA|평균자책|승|패|세이브|홀드|AVG|RBI|HR|IP/i
          .test(joined)
      );
    })
    .slice(0, 10);
}

exports.handler = async (event) => {
  try {
    const q =
      event.queryStringParameters || {};

    const type =
      q.type || "standings";

    let payload = {
      updatedAt:
        new Date().toISOString()
    };

    if (type === "score") {
      const date =
        todayKST();

      const html =
        await get(
          `${ENG}/Schedule/Scoreboard.aspx?searchDate=${date}`
        );

      payload = {
        ...payload,
        date,
        games: scoreboard(html)
      };
    }

    else if (type === "schedule") {
      const month =
        currentMonthKST();

      const html =
        await get(
          `${ENG}/Schedule/DailySchedule.aspx?searchDate=${month}`
        );

      payload = {
        ...payload,
        month,
        ...scheduleRows(html)
      };
    }

    else if (type === "standings") {
      const html =
        await get(
          `${BASE}/Record/TeamRank/TeamRankDaily.aspx`
        );

      const ts =
        tables(html);

      const table =
        ts.find(t => {
          const h =
            t.headers.join(" ");

          return (
            h.includes("순위") &&
            (
              h.includes("팀명") ||
              h.includes("팀")
            )
          );
        }) || null;

      payload = {
        ...payload,
        table
      };
    }

    else if (type === "roster") {
      const html =
        await get(
          `${BASE}/Player/RegisterAll.aspx`
        );

      const groups =
        lotteRoster(html);

      payload = {
        ...payload,
        team: "롯데",
        groups,
        counts: {
          "투수":
            groups["투수"].length,

          "포수":
            groups["포수"].length,

          "내야수":
            groups["내야수"].length,

          "외야수":
            groups["외야수"].length
        }
      };
    }

    else if (type === "player") {
      let path =
        decodeURIComponent(
          q.path || ""
        );

      if (!path) {
        throw new Error(
          "선수 주소가 없습니다."
        );
      }

      if (/^https?:\/\//i.test(path)) {
        const u =
          new URL(path);

        if (
          !/koreabaseball\.com$/i.test(
            u.hostname
          )
        ) {
          throw new Error(
            "잘못된 선수 주소입니다."
          );
        }

        path =
          u.pathname + u.search;
      }

      if (!path.startsWith("/")) {
        path =
          "/" + path;
      }

      if (
        !/^\/Player\//i.test(path)
      ) {
        throw new Error(
          "잘못된 선수 주소입니다."
        );
      }

      const html =
        await get(
          BASE + path
        );

      payload = {
        ...payload,
        path,
        tables: playerTables(html)
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

        "cache-control":
          "no-store, no-cache, must-revalidate",

        "access-control-allow-origin":
          "*"
      },

      body:
        JSON.stringify(payload)
    };
  }

  catch (error) {
    return {
      statusCode: 500,

      headers: {
        "content-type":
          "application/json; charset=utf-8",

        "cache-control":
          "no-store",

        "access-control-allow-origin":
          "*"
      },

      body:
        JSON.stringify({
          error:
            error && error.message
              ? error.message
              : String(error)
        })
    };
  }
};
