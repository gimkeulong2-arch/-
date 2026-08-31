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

const TEAM_NAMES = [
  "LG", "DOOSAN", "SAMSUNG", "LOTTE", "HANWHA",
  "KIA", "SSG", "KIWOOM", "KT", "NC"
];

const LOCATION_KO = {
  JAMSIL: "잠실",
  SAJIK: "사직",
  SUWON: "수원",
  GWANGJU: "광주",
  CHANGWON: "창원",
  DAEGU: "대구",
  MUNHAK: "문학",
  GOCHEOKSKY: "고척",
  DAEJEON: "대전",
  POHANG: "포항",
  ULSAN: "울산"
};

function shiftMonth(month, delta) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));

  return `${d.getUTCFullYear()}-${String(
    d.getUTCMonth() + 1
  ).padStart(2, "0")}`;
}

function scheduleDateFromLabel(label, month) {
  const m = String(label || "").match(
    /^(\d{2})\.(\d{2})\([A-Z]{3}\)$/i
  );

  if (!m) {
    return "";
  }

  return `${month.slice(0, 4)}-${m[1]}-${m[2]}`;
}

function parseScheduleGames(html, month) {
  const out = [];

  const rows =
    html.match(/<tr\b[\s\S]*?<\/tr>/gi) || [];

  let currentDate = "";

  for (const row of rows) {
    const cells = [
      ...row.matchAll(
        /<td\b[^>]*>([\s\S]*?)<\/td>/gi
      )
    ]
      .map(m => cleanText(m[1]))
      .filter(Boolean);

    if (!cells.length) {
      continue;
    }

    const dateLabel =
      cells.find(
        v =>
          /^\d{2}\.\d{2}\([A-Z]{3}\)$/i.test(v)
      );

    if (dateLabel) {
      currentDate =
        scheduleDateFromLabel(
          dateLabel,
          month
        );
    }

    if (!currentDate) {
      continue;
    }

    const timeIndex =
      cells.findIndex(
        v =>
          /^\d{1,2}:\d{2}$/.test(v)
      );

    if (timeIndex < 0) {
      continue;
    }

    const after =
      cells.slice(timeIndex + 1);

    const teamPositions = [];

    after.forEach((v, i) => {
      if (
        TEAM_NAMES.includes(
          v.toUpperCase()
        )
      ) {
        teamPositions.push(i);
      }
    });

    if (teamPositions.length < 2) {
      continue;
    }

    const awayIndex =
      teamPositions[0];

    const homeIndex =
      teamPositions[1];

    const away =
      after[awayIndex].toUpperCase();

    const home =
      after[homeIndex].toUpperCase();

    if (
      away !== "LOTTE" &&
      home !== "LOTTE"
    ) {
      continue;
    }

    const between =
      after.slice(
        awayIndex + 1,
        homeIndex
      );

    const scoreText =
      between.find(
        v =>
          /^\d*\s*:\s*\d*$/.test(v)
      ) || ":";

    const sm =
      scoreText.match(
        /^(\d*)\s*:\s*(\d*)$/
      );

    const awayScore =
      sm && sm[1] !== ""
        ? Number(sm[1])
        : null;

    const homeScore =
      sm && sm[2] !== ""
        ? Number(sm[2])
        : null;

    const tail =
      after.slice(homeIndex + 1);

    const locationCode =
      tail.find(
        v =>
          LOCATION_KO[
            v.toUpperCase()
          ]
      ) || "";

    const rawStatus =
      tail.find(
        v =>
          /POSTPONED|CANCELLED|CANCELED|SUSPENDED/i.test(v)
      ) || "";

    let status = "예정";

    if (/POSTPONED/i.test(rawStatus)) {
      status = "연기";
    }

    else if (
      /CANCELLED|CANCELED/i.test(
        rawStatus
      )
    ) {
      status = "취소";
    }

    else if (
      /SUSPENDED/i.test(rawStatus)
    ) {
      status = "중단";
    }

    else if (
      awayScore !== null &&
      homeScore !== null
    ) {
      status = "종료";
    }

    out.push({
      date: currentDate,
      time: cells[timeIndex],
      away,
      home,
      awayScore,
      homeScore,

      location:
        locationCode
          ? LOCATION_KO[
              locationCode.toUpperCase()
            ]
          : "",

      locationCode,
      status
    });
  }

  return out;
}

function scoreboardGames(html) {
  const games = [];

  const matches = [
    ...html.matchAll(
      /<table\b[\s\S]*?<\/table>/gi
    )
  ];

  for (const m of matches) {
    const parsed =
      tables(m[0])[0];

    if (
      !parsed ||
      parsed.rows.length < 2
    ) {
      continue;
    }

    const headers =
      parsed.headers.map(
        h => h.toUpperCase()
      );

    const teamIndex =
      headers.findIndex(
        h => h === "TEAM"
      );

    const rIndex =
      headers.findIndex(
        h => h === "R"
      );

    if (
      teamIndex < 0 ||
      rIndex < 0
    ) {
      continue;
    }

    const rows =
      parsed.rows.filter(
        r => r.length > rIndex
      );

    if (rows.length < 2) {
      continue;
    }

    const away =
      String(
        rows[0][teamIndex] || ""
      ).toUpperCase();

    const home =
      String(
        rows[1][teamIndex] || ""
      ).toUpperCase();

    if (
      away !== "LOTTE" &&
      home !== "LOTTE"
    ) {
      continue;
    }

    const before =
      cleanText(
        html.slice(
          Math.max(
            0,
            m.index - 1400
          ),
          m.index
        )
      );

    const timeMatches = [
      ...before.matchAll(
        /\b\d{1,2}:\d{2}\b/g
      )
    ];

    const time =
      timeMatches.length
        ? timeMatches[
            timeMatches.length - 1
          ][0]
        : "";

    let location = "";
    let locationCode = "";

    for (
      const code of
      Object.keys(LOCATION_KO)
    ) {
      if (
        new RegExp(
          `\\b${code}\\b`,
          "i"
        ).test(before)
      ) {
        locationCode = code;
        location =
          LOCATION_KO[code];
      }
    }

    const n = v =>
      /^-?\d+$/.test(
        String(v || "")
      )
        ? Number(v)
        : null;

    const awayScore =
      n(rows[0][rIndex]);

    const homeScore =
      n(rows[1][rIndex]);

    const total = (row, key) => {
      const i =
        headers.findIndex(
          h => h === key
        );

      return i >= 0
        ? row[i]
        : "";
    };

    games.push({
      away,
      home,
      awayScore,
      homeScore,
      time,
      location,
      locationCode,

      status:
        /\bFINAL\b/i.test(before)
          ? "종료"
          : "진행 중",

      totals: {
        away: {
          R: total(
            rows[0],
            "R"
          ),
          H: total(
            rows[0],
            "H"
          ),
          E: total(
            rows[0],
            "E"
          ),
          B: total(
            rows[0],
            "B"
          )
        },

        home: {
          R: total(
            rows[1],
            "R"
          ),
          H: total(
            rows[1],
            "H"
          ),
          E: total(
            rows[1],
            "E"
          ),
          B: total(
            rows[1],
            "B"
          )
        }
      },

      innings: {
        headers:
          parsed.headers,

        rows:
          rows.slice(0, 2)
      }
    });
  }

  return games;
}

function gameSortKey(g) {
  return `${g.date || ""}T${g.time || "00:00"}`;
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

        const month =
          date.slice(0, 7);

        const [
          scheduleHtml,
          boardHtml
        ] =
          await Promise.all([
            get(
              `${ENG}/Schedule/DailySchedule.aspx?searchDate=${month}`
            ),

            get(
              `${ENG}/Schedule/Scoreboard.aspx?searchDate=${date}`
            ).catch(
              () => ""
            )
          ]);

        const scheduled =
          parseScheduleGames(
            scheduleHtml,
            month
          ).find(
            g =>
              g.date === date
          ) || null;

        const board =
          boardHtml
            ? (
                scoreboardGames(
                  boardHtml
                )[0] || null
              )
            : null;

        let game = null;

        if (board) {
          game = {
            ...(scheduled || {}),
            ...board,
            date,

            time:
              board.time ||
              (
                scheduled &&
                scheduled.time
              ) ||
              "",

            location:
              board.location ||
              (
                scheduled &&
                scheduled.location
              ) ||
              ""
          };
        }

        else if (scheduled) {
          game = scheduled;
        }

        payload = {
          ...payload,
          date,

          games:
            game
              ? [game]
              : []
        };
      }

      else if (
        type === "schedule"
      ) {
        const current =
          currentMonthKST();

        const months = [
          shiftMonth(
            current,
            -1
          ),

          current,

          shiftMonth(
            current,
            1
          )
        ];

        const htmls =
          await Promise.all(
            months.map(
              month =>
                get(
                  `${ENG}/Schedule/DailySchedule.aspx?searchDate=${month}`
                ).then(
                  html => ({
                    month,
                    html
                  })
                )
            )
          );

        const allGames =
          htmls
            .flatMap(
              ({
                month,
                html
              }) =>
                parseScheduleGames(
                  html,
                  month
                )
            )
            .filter(
              (
                g,
                i,
                arr
              ) =>
                arr.findIndex(
                  x =>
                    x.date ===
                      g.date &&
                    x.time ===
                      g.time &&
                    x.away ===
                      g.away &&
                    x.home ===
                      g.home
                ) === i
            )
            .sort(
              (a, b) =>
                gameSortKey(a)
                  .localeCompare(
                    gameSortKey(b)
                  )
            );

        const today =
          todayKST();

        const recent =
          allGames
            .filter(
              g =>
                g.status ===
                  "종료" &&
                g.date <= today
            )
            .slice(-3)
            .reverse();

        const upcoming =
          allGames
            .filter(
              g =>
                g.status ===
                  "예정" &&
                (
                  g.date > today ||
                  g.date === today
                )
            )
            .slice(0, 3);

        payload = {
          ...payload,

          month:
            current,

          recent,

          upcoming,

          games:
            [...recent]
              .reverse()
              .concat(
                upcoming
              )
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
