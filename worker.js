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
  const tableMatches = html.match(/<table\b[\s\S]*?<\/table>/gi) || [];

  for (const tableHtml of tableMatches) {
    const rows = tableHtml.match(/<tr\b[\s\S]*?<\/tr>/gi) || [];

    let headers = [];
    const body = [];

    for (const row of rows) {
      const ths = [
        ...row.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)
      ].map(m => cleanText(m[1]));

      const tds = [
        ...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)
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

  if (!href) {
    return "";
  }

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
    ...cellHtml.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)
  ];

  for (const m of anchors) {
    const hrefMatch = m[1].match(
      /href\s*=\s*["']([^"']+)["']/i
    );

    const label = cleanText(m[2]);

    const pm = label.match(
      /^(.+?)\s*\(\s*(\d{1,3})\s*\)$/
    );

    if (!pm) {
      continue;
    }

    players.push({
      name: pm[1].trim(),
      number: pm[2],
      path: normalizePlayerPath(
        hrefMatch ? hrefMatch[1] : ""
      )
    });
  }

  if (!players.length) {
    const raw = cleanText(cellHtml);

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
    const key = `${p.name}|${p.number}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function lotteRoster(html) {
  const tablesHtml =
    html.match(/<table\b[\s\S]*?<\/table>/gi) || [];

  for (const tableHtml of tablesHtml) {
    if (!cleanText(tableHtml).includes("롯데")) {
      continue;
    }

    const rows =
      tableHtml.match(/<tr\b[\s\S]*?<\/tr>/gi) || [];

    for (const row of rows) {
      const cells = [
        ...row.matchAll(
          /<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/gi
        )
      ].map(m => m[2]);

      if (cells.length < 7) {
        continue;
      }

      if (!cleanText(cells[0]).includes("롯데")) {
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

function parseSearchResults(html) {
  const out = [];

  const rows =
    html.match(/<tr\b[\s\S]*?<\/tr>/gi) || [];

  for (const row of rows) {
    const rawCells = [
      ...row.matchAll(
        /<td\b[^>]*>([\s\S]*?)<\/td>/gi
      )
    ].map(m => m[1]);

    if (rawCells.length < 4) {
      continue;
    }

    const number =
      cleanText(rawCells[0]).replace(/^#$/, "");

    const name =
      cleanText(rawCells[1]);

    const team =
      cleanText(rawCells[2]);

    const position =
      cleanText(rawCells[3]);

    const hrefMatch =
      rawCells[1].match(
        /href\s*=\s*["']([^"']+)["']/i
      );

    const path =
      normalizePlayerPath(
        hrefMatch ? hrefMatch[1] : ""
      );

    if (
      !name ||
      !team ||
      !position ||
      !path
    ) {
      continue;
    }

    out.push({
      number,
      name,
      team,
      position,
      path
    });
  }

  return out;
}

async function findLottePlayer(
  name,
  number = "",
  position = ""
) {
  const url =
    `${BASE}/Player/Search.aspx?searchWord=` +
    encodeURIComponent(name);

  const html = await get(url);

  const results =
    parseSearchResults(html);

  const exact =
    results.filter(
      p =>
        p.name === name &&
        p.team.includes("롯데")
    );

  if (!exact.length) {
    throw new Error(
      `${name} 선수의 롯데 검색 결과를 찾지 못했습니다.`
    );
  }

  let picked =
    exact.find(
      p =>
        number &&
        p.number === String(number) &&
        (
          !position ||
          p.position.includes(position)
        )
    );

  if (!picked) {
    picked =
      exact.find(
        p =>
          number &&
          p.number === String(number)
      );
  }

  if (!picked) {
    picked =
      exact.find(
        p =>
          position &&
          p.position.includes(position)
      );
  }

  if (!picked) {
    picked = exact[0];
  }

  return picked;
}

function parseProfile(html) {
  const all = cleanText(html);

  function grab(label) {
    const re = new RegExp(
      `${label}\\s*:\\s*([^·|]+?)(?=\\s+(?:선수명|등번호|생년월일|포지션|신장/체중|경력|입단 계약금|연봉|지명순위|입단년도)\\s*:|$)`
    );

    const m = all.match(re);

    return m
      ? m[1].trim()
      : "";
  }

  return {
    name: grab("선수명"),
    number: grab("등번호")
      .replace(/^No\.?\s*/i, ""),
    birth: grab("생년월일"),
    position: grab("포지션"),
    size: grab("신장/체중"),
    career: grab("경력"),
    salary: grab("연봉")
  };
}

function seasonTables(html) {
  const ts = tables(html);

  return ts
    .filter(t => {
      if (!t.rows.length) {
        return false;
      }

      const joined =
        `${t.headers.join(" ")} ` +
        `${t.rows.flat().join(" ")}`;

      return /ERA|AVG|타율|안타|홈런|타점|득점|도루|W|L|SV|HLD|IP|SO|RBI|HR|OPS|OBP|SLG/i.test(
        joined
      );
    })
    .slice(0, 6);
}

function scheduleRows(html) {
  const ts = tables(html);

  let best = null;

  for (const t of ts) {
    const joined =
      `${t.headers.join(" ")} ` +
      `${t.rows.flat().join(" ")}`;

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

  return {
    headers:
      best
        ? best.headers
        : [],

    rows:
      best
        ? best.rows.filter(
            r =>
              /LOTTE|Lotte|롯데/i.test(
                r.join(" ")
              )
          )
        : []
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

export default {
  async fetch(request, env) {
    const url =
      new URL(request.url);

    if (
      url.pathname !== "/api/kbo"
    ) {
      return env.ASSETS.fetch(
        request
      );
    }

    const headers = {
      "content-type":
        "application/json; charset=utf-8",

      "cache-control":
        "no-store, no-cache, must-revalidate",

      "access-control-allow-origin":
        "*"
    };

    try {
      const q =
        Object.fromEntries(
          url.searchParams.entries()
        );

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
          games:
            scoreboard(html)
        };
      }

      else if (
        type === "schedule"
      ) {
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

      else if (
        type === "standings"
      ) {
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

      else if (
        type === "roster"
      ) {
        const html =
          await get(
            `${BASE}/Player/RegisterAll.aspx`
          );

        const groups =
          lotteRoster(html);

        payload = {
          ...payload,

          team:
            "롯데",

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

      else if (
        type === "player"
      ) {
        const name =
          (q.name || "").trim();

        const number =
          (q.number || "").trim();

        const position =
          (q.position || "").trim();

        if (!name) {
          throw new Error(
            "선수 이름이 없습니다."
          );
        }

        const found =
          await findLottePlayer(
            name,
            number,
            position
          );

        const html =
          await get(
            BASE + found.path
          );

        payload = {
          ...payload,

          player:
            found,

          profile:
            parseProfile(html),

          tables:
            seasonTables(html)
        };
      }

      else {
        throw new Error(
          "지원하지 않는 요청입니다."
        );
      }

      return new Response(
        JSON.stringify(payload),
        {
          status: 200,
          headers
        }
      );
    }

    catch (error) {
      return new Response(
        JSON.stringify({
          error:
            error &&
            error.message
              ? error.message
              : String(error)
        }),
        {
          status: 500,
          headers
        }
      );
    }
  }
};
