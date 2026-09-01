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
    .replace(/&#(\d+);/g, (_, n) =>
      String.fromCharCode(Number(n))
    );
}

function cleanText(html = "") {
  return decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/\s+/g, " ")
    .trim();
}

async function get(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 Chrome/130 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language":
        "ko-KR,ko;q=0.9,en;q=0.8"
    }
  });

  if (!res.ok) {
    throw new Error(
      `KBO 요청 실패: ${res.status}`
    );
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
    html.match(
      /<table\b[\s\S]*?<\/table>/gi
    ) || [];

  for (const tableHtml of tableMatches) {
    const rows =
      tableHtml.match(
        /<tr\b[\s\S]*?<\/tr>/gi
      ) || [];

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

      if (
        ths.length &&
        !headers.length
      ) {
        headers = ths;
      }

      if (tds.length) {
        body.push(tds);
      }
    }

    if (
      headers.length ||
      body.length
    ) {
      result.push({
        headers,
        rows: body
      });
    }
  }

  return result;
}

function normalizePlayerPath(
  href = ""
) {
  href = decodeHtml(href).trim();

  if (!href) {
    return "";
  }

  if (/^https?:\/\//i.test(href)) {
    try {
      const u = new URL(href);

      if (
        !/koreabaseball\.com$/i.test(
          u.hostname
        )
      ) {
        return "";
      }

      return u.pathname + u.search;
    } catch (_) {
      return "";
    }
  }

  return href.startsWith("/")
    ? href
    : "/" +
        href.replace(
          /^\.?\//,
          ""
        );
}

function extractPlayers(
  cellHtml
) {
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

    if (!pm) {
      continue;
    }

    players.push({
      name:
        pm[1].trim(),

      number:
        pm[2],

      path:
        normalizePlayerPath(
          hrefMatch
            ? hrefMatch[1]
            : ""
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
        name:
          m[1].trim(),

        number:
          m[2],

        path: ""
      });
    }
  }

  const seen =
    new Set();

  return players.filter(
    p => {
      const key =
        `${p.name}|${p.number}`;

      if (
        seen.has(key)
      ) {
        return false;
      }

      seen.add(key);

      return true;
    }
  );
}

function lotteRoster(html) {
  const tablesHtml =
    html.match(
      /<table\b[\s\S]*?<\/table>/gi
    ) || [];

  for (
    const tableHtml
    of tablesHtml
  ) {
    if (
      !cleanText(
        tableHtml
      ).includes("롯데")
    ) {
      continue;
    }

    const rows =
      tableHtml.match(
        /<tr\b[\s\S]*?<\/tr>/gi
      ) || [];

    for (
      const row of rows
    ) {
      const cells = [
        ...row.matchAll(
          /<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/gi
        )
      ].map(m => m[2]);

      if (
        cells.length < 7
      ) {
        continue;
      }

      if (
        !cleanText(
          cells[0]
        ).includes("롯데")
      ) {
        continue;
      }

      return {
        투수:
          extractPlayers(
            cells[3]
          ),

        포수:
          extractPlayers(
            cells[4]
          ),

        내야수:
          extractPlayers(
            cells[5]
          ),

        외야수:
          extractPlayers(
            cells[6]
          )
      };
    }
  }

  throw new Error(
    "KBO 페이지에서 롯데 선수단 행을 찾지 못했습니다."
  );
}

function parseSearchResults(
  html
) {
  const out = [];

  const rows =
    html.match(
      /<tr\b[\s\S]*?<\/tr>/gi
    ) || [];

  for (const row of rows) {
    const rawCells = [
      ...row.matchAll(
        /<td\b[^>]*>([\s\S]*?)<\/td>/gi
      )
    ].map(m => m[1]);

    if (
      rawCells.length < 4
    ) {
      continue;
    }

    const number =
      cleanText(
        rawCells[0]
      ).replace(
        /^#$/,
        ""
      );

    const name =
      cleanText(
        rawCells[1]
      );

    const team =
      cleanText(
        rawCells[2]
      );

    const position =
      cleanText(
        rawCells[3]
      );

    const hrefMatch =
      rawCells[1].match(
        /href\s*=\s*["']([^"']+)["']/i
      );

    const path =
      normalizePlayerPath(
        hrefMatch
          ? hrefMatch[1]
          : ""
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

  const html =
    await get(url);

  const results =
    parseSearchResults(
      html
    );

  const exact =
    results.filter(
      p =>
        p.name === name &&
        p.team.includes(
          "롯데"
        )
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
        p.number ===
          String(number) &&
        (
          !position ||
          p.position.includes(
            position
          )
        )
    );

  if (!picked) {
    picked =
      exact.find(
        p =>
          number &&
          p.number ===
            String(number)
      );
  }

  if (!picked) {
    picked =
      exact.find(
        p =>
          position &&
          p.position.includes(
            position
          )
      );
  }

  if (!picked) {
    picked =
      exact[0];
  }

  return picked;
}

function parseProfile(
  html
) {
  const all =
    cleanText(html);

  function grab(label) {
    const re =
      new RegExp(
        `${label}\\s*:\\s*([^·|]+?)(?=\\s+(?:선수명|등번호|생년월일|포지션|신장/체중|경력|입단 계약금|연봉|지명순위|입단년도)\\s*:|$)`
      );

    const m =
      all.match(re);

    return m
      ? m[1].trim()
      : "";
  }

  return {
    name:
      grab("선수명"),

    number:
      grab("등번호")
        .replace(
          /^No\.?\s*/i,
          ""
        ),

    birth:
      grab("생년월일"),

    position:
      grab("포지션"),

    size:
      grab("신장/체중"),

    career:
      grab("경력"),

    salary:
      grab("연봉")
  };
}

function seasonTables(
  html
) {
  const ts =
    tables(html);

  return ts
    .filter(t => {
      if (
        !t.rows.length
      ) {
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
  "LG",
  "DOOSAN",
  "SAMSUNG",
  "LOTTE",
  "HANWHA",
  "KIA",
  "SSG",
  "KIWOOM",
  "KT",
  "NC"
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

function shiftMonth(
  month,
  delta
) {
  const [y, m] =
    month
      .split("-")
      .map(Number);

  const d =
    new Date(
      Date.UTC(
        y,
        m - 1 + delta,
        1
      )
    );

  return (
    `${d.getUTCFullYear()}-` +
    `${String(
      d.getUTCMonth() + 1
    ).padStart(2, "0")}`
  );
}

function scheduleDateFromLabel(
  label,
  month
) {
  const m =
    String(
      label || ""
    ).match(
      /^(\d{2})\.(\d{2})\([A-Z]{3}\)$/i
    );

  if (!m) {
    return "";
  }

  return (
    `${month.slice(0, 4)}-` +
    `${m[1]}-${m[2]}`
  );
    }function parseScheduleGames(
  html,
  month
) {
  const out = [];
  const rows =
    html.match(
      /<tr\b[\s\S]*?<\/tr>/gi
    ) || [];

  let currentDate = "";
  const today = todayKST();

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
      cells.find(v =>
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
      cells.findIndex(v =>
        /^\d{1,2}:\d{2}$/.test(v)
      );

    if (timeIndex < 0) {
      continue;
    }

    const after =
      cells.slice(
        timeIndex + 1
      );

    const teamPositions = [];

    after.forEach(
      (v, i) => {
        const upper =
          v.toUpperCase();

        if (
          TEAM_NAMES.includes(
            upper
          )
        ) {
          teamPositions.push(i);
        }
      }
    );

    if (
      teamPositions.length < 2
    ) {
      const joined =
        after.join(" ");

      const foundTeams = [];

      for (
        const team
        of TEAM_NAMES
      ) {
        const re =
          new RegExp(
            `\\b${team}\\b`,
            "i"
          );

        const match =
          joined.match(re);

        if (match) {
          foundTeams.push({
            team,
            index: match.index
          });
        }
      }

      foundTeams.sort(
        (a, b) =>
          a.index - b.index
      );

      if (
        foundTeams.length < 2
      ) {
        continue;
      }

      const away =
        foundTeams[0].team;

      const home =
        foundTeams[1].team;

      if (
        away !== "LOTTE" &&
        home !== "LOTTE"
      ) {
        continue;
      }

      const scoreMatch =
        joined.match(
          /\b(\d{1,2})\s*[:\-]\s*(\d{1,2})\b/
        );

      const awayScore =
        scoreMatch
          ? Number(
              scoreMatch[1]
            )
          : null;

      const homeScore =
        scoreMatch
          ? Number(
              scoreMatch[2]
            )
          : null;

      let location = "";
      let locationCode = "";

      for (
        const code
        of Object.keys(
          LOCATION_KO
        )
      ) {
        if (
          new RegExp(
            `\\b${code}\\b`,
            "i"
          ).test(joined)
        ) {
          locationCode = code;
          location =
            LOCATION_KO[code];
          break;
        }
      }

      let status = "예정";

      if (
        /POSTPONED/i.test(
          joined
        )
      ) {
        status = "연기";
      }

      else if (
        /CANCELLED|CANCELED/i.test(
          joined
        )
      ) {
        status = "취소";
      }

      else if (
        /SUSPENDED/i.test(
          joined
        )
      ) {
        status = "중단";
      }

      else if (
        currentDate < today
      ) {
        status = "종료";
      }

      else if (
        awayScore !== null &&
        homeScore !== null
      ) {
        status = "종료";
      }

      out.push({
        date: currentDate,
        time:
          cells[timeIndex],
        away,
        home,
        awayScore,
        homeScore,
        location,
        locationCode,
        status
      });

      continue;
    }

    const awayIndex =
      teamPositions[0];

    const homeIndex =
      teamPositions[1];

    const away =
      after[
        awayIndex
      ].toUpperCase();

    const home =
      after[
        homeIndex
      ].toUpperCase();

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

    const betweenText =
      between.join(" ");

    let awayScore = null;
    let homeScore = null;

    const scoreMatch =
      betweenText.match(
        /(\d{1,2})\s*[:\-]\s*(\d{1,2})/
      );

    if (scoreMatch) {
      awayScore =
        Number(
          scoreMatch[1]
        );

      homeScore =
        Number(
          scoreMatch[2]
        );
    }

    if (
      awayScore === null ||
      homeScore === null
    ) {
      const nums =
        between
          .filter(v =>
            /^\d{1,2}$/.test(v)
          )
          .map(Number);

      if (
        nums.length >= 2
      ) {
        awayScore = nums[0];
        homeScore = nums[1];
      }
    }

    const tail =
      after.slice(
        homeIndex + 1
      );

    const tailText =
      tail.join(" ");

    const locationCode =
      tail.find(v =>
        LOCATION_KO[
          v.toUpperCase()
        ]
      ) || "";

    const rawStatus =
      tail.find(v =>
        /POSTPONED|CANCELLED|CANCELED|SUSPENDED/i.test(
          v
        )
      ) || "";

    let status = "예정";

    if (
      /POSTPONED/i.test(
        rawStatus
      )
    ) {
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
      /SUSPENDED/i.test(
        rawStatus
      )
    ) {
      status = "중단";
    }

    else if (
      currentDate < today
    ) {
      status = "종료";
    }

    else if (
      awayScore !== null &&
      homeScore !== null
    ) {
      status = "종료";
    }

    out.push({
      date:
        currentDate,

      time:
        cells[
          timeIndex
        ],

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

      status,

      raw:
        tailText
    });
  }

  return out;
}

function scoreboardGames(
  html
) {
  const games = [];

  const matches = [
    ...html.matchAll(
      /<table\b[\s\S]*?<\/table>/gi
    )
  ];

  for (const m of matches) {
    const parsed =
      tables(
        m[0]
      )[0];

    if (
      !parsed ||
      parsed.rows.length < 2
    ) {
      continue;
    }

    const headers =
      parsed.headers.map(
        h =>
          h.toUpperCase()
      );

    const teamIndex =
      headers.findIndex(
        h =>
          h === "TEAM"
      );

    const rIndex =
      headers.findIndex(
        h =>
          h === "R"
      );

    if (
      teamIndex < 0 ||
      rIndex < 0
    ) {
      continue;
    }

    const rows =
      parsed.rows.filter(
        r =>
          r.length >
          rIndex
      );

    if (
      rows.length < 2
    ) {
      continue;
    }

    const away =
      String(
        rows[0][
          teamIndex
        ] || ""
      ).toUpperCase();

    const home =
      String(
        rows[1][
          teamIndex
        ] || ""
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
            timeMatches.length -
              1
          ][0]
        : "";

    let location = "";
    let locationCode = "";

    for (
      const code of
      Object.keys(
        LOCATION_KO
      )
    ) {
      if (
        new RegExp(
          `\\b${code}\\b`,
          "i"
        ).test(
          before
        )
      ) {
        locationCode = code;

        location =
          LOCATION_KO[
            code
          ];
      }
    }

    const n =
      v =>
        /^-?\d+$/.test(
          String(
            v || ""
          )
        )
          ? Number(v)
          : null;

    const awayScore =
      n(
        rows[0][
          rIndex
        ]
      );

    const homeScore =
      n(
        rows[1][
          rIndex
        ]
      );

    const total =
      (row, key) => {
        const i =
          headers.findIndex(
            h =>
              h === key
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
        /\bFINAL\b/i.test(
          before
        )
          ? "종료"
          : "진행 중",

      totals: {
        away: {
          R:
            total(
              rows[0],
              "R"
            ),

          H:
            total(
              rows[0],
              "H"
            ),

          E:
            total(
              rows[0],
              "E"
            ),

          B:
            total(
              rows[0],
              "B"
            )
        },

        home: {
          R:
            total(
              rows[1],
              "R"
            ),

          H:
            total(
              rows[1],
              "H"
            ),

          E:
            total(
              rows[1],
              "E"
            ),

          B:
            total(
              rows[1],
              "B"
            )
        }
      },

      innings: {
        headers:
          parsed.headers,

        rows:
          rows.slice(
            0,
            2
          )
      }
    });
  }

  return games;
}


/*
 * KBO 게임센터 API
 */

const GAME_LIST_API =
  `${BASE}/ws/Main.asmx/GetKboGameList`;

const SCHEDULE_API =
  `${BASE}/ws/Schedule.asmx`;

/*
 * 중요:
 * KBO API 요청에 사용하는 User-Agent.
 */
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/130.0 Safari/537.36";

function compactDate(
  v = ""
) {
  return String(v)
    .replace(
      /\D/g,
      ""
    )
    .slice(
      0,
      8
    );
}

function normDate(
  v = ""
) {
  const d =
    compactDate(v);

  return d.length === 8
    ? (
        `${d.slice(0, 4)}-` +
        `${d.slice(4, 6)}-` +
        `${d.slice(6, 8)}`
      )
    : "";
}

function shiftDate(
  date,
  delta
) {
  const [
    y,
    m,
    d
  ] =
    date
      .split("-")
      .map(Number);

  const x =
    new Date(
      Date.UTC(
        y,
        m - 1,
        d + delta
      )
    );

  return (
    `${x.getUTCFullYear()}-` +
    `${String(
      x.getUTCMonth() + 1
    ).padStart(2, "0")}-` +
    `${String(
      x.getUTCDate()
    ).padStart(2, "0")}`
  );
}

function nnum(v) {
  if (
    v === null ||
    v === undefined ||
    v === "" ||
    v === "-"
  ) {
    return null;
  }

  const n =
    Number(
      String(v).replace(
        /,/g,
        ""
      )
    );

  return Number.isFinite(n)
    ? n
    : null;
}

function person(
  id,
  name
) {
  name =
    String(
      name || ""
    ).trim();

  return name
    ? {
        id:
          id || null,

        name
      }
    : null;
}

function teamName(
  name = "",
  id = ""
) {
  const x =
    String(
      name ||
      id ||
      ""
    )
      .trim()
      .toUpperCase();

  const map = {
    "롯데": "LOTTE",
    LT: "LOTTE",
    LOTTE: "LOTTE",

    "삼성": "SAMSUNG",
    SS: "SAMSUNG",
    SAMSUNG: "SAMSUNG",

    "두산": "DOOSAN",
    OB: "DOOSAN",
    DOOSAN: "DOOSAN",

    "한화": "HANWHA",
    HH: "HANWHA",
    HANWHA: "HANWHA",

    "키움": "KIWOOM",
    WO: "KIWOOM",
    KIWOOM: "KIWOOM",

    LG: "LG",

    KIA: "KIA",
    HT: "KIA",

    SSG: "SSG",
    SK: "SSG",

    KT: "KT",
    NC: "NC"
  };

  return map[x] || x;
}

async function gameList(
  date
) {
  const r =
    await fetch(
      GAME_LIST_API,
      {
        method:
          "POST",

        headers: {
          "content-type":
            "application/json; charset=UTF-8",

          "user-agent":
            UA,

          referer:
            `${BASE}/Schedule/GameCenter/Main.aspx`
        },

        body:
          JSON.stringify({
            leId: "1",
            srId: "0",
            date:
              compactDate(
                date
              )
          })
      }
    );

  if (!r.ok) {
    throw new Error(
      `KBO 게임센터 요청 실패: ${r.status}`
    );
  }

  const text =
    await r.text();

  const cut =
    text.search(
      /<!DOCTYPE|<html/i
    );

  const clean =
    (
      cut >= 0
        ? text.slice(
            0,
            cut
          )
        : text
    ).trim();

  const j =
    JSON.parse(
      clean || "{}"
    );

  return Array.isArray(
    j.game
  )
    ? j.game
    : [];
}

function publicGame(
  x,
  fallback = ""
) {
  const date =
    normDate(
      x.G_DT
    ) || fallback;

  const away =
    teamName(
      x.AWAY_NM,
      x.AWAY_ID
    );

  const home =
    teamName(
      x.HOME_NM,
      x.HOME_ID
    );

  const cancel =
    String(
      x.CANCEL_SC_NM ||
      ""
    ).trim();

  let status =
    "경기 전";

  const inn =
    nnum(
      x.GAME_INN_NO
    );

  if (cancel) {
    status =
      /취소|CANCEL/i.test(
        cancel
      )
        ? "취소"
        : cancel;
  }

  else if (
    inn !== null &&
    inn > 0
  ) {
    status =
      `${inn}회` +
      `${String(
        x.GAME_TB_SC_NM ||
        ""
      ).trim()}`;
  }

  else if (
    date &&
    date < todayKST()
  ) {
    status =
      "종료";
  }

  return {
    gameId:
      String(
        x.G_ID || ""
      ),

    date,

    time:
      String(
        x.G_TM || ""
      ),

    location:
      String(
        x.S_NM || ""
      ),

    away,
    home,

    awayScore:
      nnum(
        x.T_SCORE_CN
      ),

    homeScore:
      nnum(
        x.B_SCORE_CN
      ),

    status,

    inning:
      inn,

    topBottom:
      String(
        x.GAME_TB_SC_NM ||
        ""
      ),

    count: {
      ball:
        nnum(
          x.BALL_CN
        ),

      strike:
        nnum(
          x.STRIKE_CN
        ),

      out:
        nnum(
          x.OUT_CN
        )
    },

    runners: {
      first:
        nnum(
          x.B1_BAT_ORDER_NO
        ) !== null,

      second:
        nnum(
          x.B2_BAT_ORDER_NO
        ) !== null,

      third:
        nnum(
          x.B3_BAT_ORDER_NO
        ) !== null
    },

    currentBatter:
      person(
        x.T_P_ID,
        x.T_P_NM
      ),

    currentPitcher:
      person(
        x.B_P_ID,
        x.B_P_NM
      ),

    startingPitchers: {
      away:
        person(
          x.T_PIT_P_ID,
          x.T_PIT_P_NM
        ),

      home:
        person(
          x.B_PIT_P_ID,
          x.B_PIT_P_NM
        )
    }
  };
}

function isLotte(g) {
  return (
    g &&
    (
      g.away ===
        "LOTTE" ||
      g.home ===
        "LOTTE"
    )
  );
}


/*
 * D-3 최근 경기
 *
 * 기존 방식:
 * 과거 GetKboGameList의 점수가
 * null이면 경기를 버렸음.
 *
 * 새 방식:
 * 공식 KBO ScoreBoard 페이지를
 * 날짜별로 직접 읽어서
 * 최종 점수를 찾는다.
 */

async function recentLotteFinalGames(
  today,
  wanted = 3
) {
  const found = [];
  const seen =
    new Set();

  const teamMap = {
    "롯데": "LOTTE",
    "LOTTE": "LOTTE",

    "삼성": "SAMSUNG",
    "SAMSUNG": "SAMSUNG",

    "두산": "DOOSAN",
    "DOOSAN": "DOOSAN",

    "한화": "HANWHA",
    "HANWHA": "HANWHA",

    "키움": "KIWOOM",
    "KIWOOM": "KIWOOM",

    "KIA": "KIA",
    "SSG": "SSG",
    "LG": "LG",
    "KT": "KT",
    "NC": "NC"
  };

  function normalizeTeam(
    value
  ) {
    const s =
      String(
        value || ""
      ).trim();

    return (
      teamMap[s] ||
      teamName(
        s,
        s
      )
    );
  }

  /*
   * 시즌 중 최근 3경기는
   * 보통 며칠 안에 존재하지만
   * 우천취소/휴식일을 고려해
   * 최대 45일 전까지 확인.
   */
  for (
    let daysAgo = 1;
    daysAgo <= 45 &&
    found.length < wanted;
    daysAgo++
  ) {
    const date =
      shiftDate(
        today,
        -daysAgo
      );

    let html = "";

    /*
     * 영문 KBO 스코어보드를
     * 먼저 사용한다.
     */
    try {
      html =
        await get(
          `${ENG}/Schedule/Scoreboard.aspx?searchDate=${date}`
        );
    } catch (_) {
      /*
       * 실패하면 한국 KBO
       * 스코어보드로 한 번 더 시도.
       */
      try {
        html =
          await get(
            `${BASE}/Schedule/ScoreBoard.aspx?searchDate=${date}`
          );
      } catch (_) {
        continue;
      }
    }

    const tableMatches = [
      ...html.matchAll(
        /<table\b[\s\S]*?<\/table>/gi
      )
    ];

    for (
      const match
      of tableMatches
    ) {
      const parsed =
        tables(
          match[0]
        )[0];

      if (
        !parsed ||
        parsed.rows.length < 2
      ) {
        continue;
      }

      const headers =
        parsed.headers.map(
          h =>
            String(
              h || ""
            )
              .trim()
              .toUpperCase()
        );

      const teamIndex =
        headers.findIndex(
          h =>
            h === "TEAM" ||
            h === "팀" ||
            h === "팀명"
        );

      const runIndex =
        headers.findIndex(
          h =>
            h === "R" ||
            h === "득점"
        );

      if (
        teamIndex < 0 ||
        runIndex < 0
      ) {
        continue;
      }

      const rows =
        parsed.rows.filter(
          row =>
            row.length >
            Math.max(
              teamIndex,
              runIndex
            )
        );

      if (
        rows.length < 2
      ) {
        continue;
      }

      const away =
        normalizeTeam(
          rows[0][
            teamIndex
          ]
        );

      const home =
        normalizeTeam(
          rows[1][
            teamIndex
          ]
        );

      if (
        away !== "LOTTE" &&
        home !== "LOTTE"
      ) {
        continue;
      }

      const awayScore =
        nnum(
          rows[0][
            runIndex
          ]
        );

      const homeScore =
        nnum(
          rows[1][
            runIndex
          ]
        );

      /*
       * 최종 점수가 없는 테이블은
       * 최근 경기로 사용하지 않는다.
       */
      if (
        awayScore === null ||
        homeScore === null
      ) {
        continue;
      }

      const before =
        cleanText(
          html.slice(
            Math.max(
              0,
              match.index -
                2000
            ),
            match.index
          )
        );

      /*
       * 취소된 경기는 제외.
       */
      if (
        /CANCELLED|CANCELED|취소/i.test(
          before
        )
      ) {
        continue;
      }

      const times = [
        ...before.matchAll(
          /\b([01]?\d|2[0-3]):[0-5]\d\b/g
        )
      ];

      const time =
        times.length
          ? times[
              times.length - 1
            ][0]
          : "";

      let location = "";

      const stadiums = [
        "잠실",
        "사직",
        "대구",
        "대전",
        "광주",
        "수원",
        "창원",
        "고척",
        "문학",
        "울산",
        "포항"
      ];

      for (
        const stadium
        of stadiums
      ) {
        if (
          before.includes(
            stadium
          )
        ) {
          location =
            stadium;
        }
      }

      /*
       * 영문 페이지의 구장명도 처리.
       */
      if (!location) {
        for (
          const [
            code,
            korean
          ]
          of Object.entries(
            LOCATION_KO
          )
        ) {
          if (
            new RegExp(
              `\\b${code}\\b`,
              "i"
            ).test(
              before
            )
          ) {
            location =
              korean;
          }
        }
      }

      const key =
        `${date}|${away}|${home}`;

      if (
        seen.has(key)
      ) {
        continue;
      }

      seen.add(key);

      /*
       * gameId는 과거 게임센터 API에서
       * 실제 ID를 얻을 수 있으면 사용한다.
       * 실패해도 D-3 표시는 가능하다.
       */
      let gameId = "";

      try {
        const rawGames =
          await gameList(
            date
          );

        const matched =
          rawGames.find(
            x => {
              const g =
                publicGame(
                  x,
                  date
                );

              return (
                g.away === away &&
                g.home === home
              );
            }
          );

        if (matched) {
          gameId =
            String(
              matched.G_ID ||
              ""
            );
        }
      } catch (_) {
        gameId = "";
      }

      found.push({
        gameId,

        date,
        time,

        away,
        home,

        awayScore,
        homeScore,

        location,

        status:
          "종료"
      });
    }
  }

  found.sort(
    (a, b) =>
      gameSortKey(b)
        .localeCompare(
          gameSortKey(a)
        )
  );

  return found.slice(
    0,
    wanted
  );
}

async function postSchedule(
  method,
  params
) {
  const body =
    new URLSearchParams();

  for (
    const [k, v]
    of Object.entries(
      params
    )
  ) {
    body.set(
      k,
      String(v)
    );
  }

  const r =
    await fetch(
      `${SCHEDULE_API}/${method}`,
      {
        method:
          "POST",

        headers: {
          "content-type":
            "application/x-www-form-urlencoded; charset=UTF-8",

          "x-requested-with":
            "XMLHttpRequest",

          "user-agent":
            UA,

          referer:
            `${BASE}/Schedule/GameCenter/Main.aspx`
        },

        body:
          body.toString()
      }
    );

  if (!r.ok) {
    throw new Error(
      `${method} 요청 실패: ${r.status}`
    );
  }

  return r.json();
}

function tableJson(
  raw
) {
  if (!raw) {
    return {
      headers: [],
      rows: [],
      tfoot: []
    };
  }

  try {
    const t =
      typeof raw ===
      "string"
        ? JSON.parse(raw)
        : raw;

    const cv =
      rs =>
        (rs || []).map(
          r =>
            (r.row || []).map(
              c =>
                cleanText(
                  c &&
                  c.Text ||
                  ""
                )
            )
        );

    return {
      headers:
        cv(t.headers),

      rows:
        cv(t.rows),

      tfoot:
        cv(t.tfoot)
    };
  } catch (_) {
    return {
      headers: [],
      rows: [],
      tfoot: []
    };
  }
}

function scoreDetail(
  raw
) {
  if (!raw) {
    return null;
  }

  const a =
    tableJson(
      raw.table2
    );

  const t =
    tableJson(
      raw.table3
    );

  const h =
    a.headers[0] ||
    [];

  const ar =
    a.rows[0] ||
    [];

  const hr =
    a.rows[1] ||
    [];

  const innings = [];

  for (
    let i = 0;
    i < h.length;
    i++
  ) {
    const inn =
      parseInt(
        h[i],
        10
      );

    if (
      Number.isFinite(
        inn
      )
    ) {
      innings.push({
        inning:
          inn,

        away:
          nnum(
            ar[i]
          ),

        home:
          nnum(
            hr[i]
          )
      });
    }
  }

  const total =
    r => ({
      runs:
        nnum(
          r &&
          r[0]
        ),

      hits:
        nnum(
          r &&
          r[1]
        ),

      errors:
        nnum(
          r &&
          r[2]
        ),

      walks:
        nnum(
          r &&
          r[3]
        )
    });

  return {
    innings,

    totals: {
      away:
        total(
          t.rows[0]
        ),

      home:
        total(
          t.rows[1]
        )
    }
  };
}

function pitchersFromTable(
  t
) {
  return t.rows.map(
    c => ({
      name:
        String(
          c[0] || ""
        ),

      appearance:
        String(
          c[1] || ""
        ),

      innings:
        String(
          c[6] || ""
        ),

      pitches:
        nnum(c[8]),

      hitsAllowed:
        nnum(c[10]),

      walksAndHbp:
        nnum(c[12]),

      strikeouts:
        nnum(c[13]),

      runs:
        nnum(c[14]),

      earnedRuns:
        nnum(c[15]),

      seasonEra:
        nnum(c[16])
    })
  );
}

function hittersFromTables(
  meta,
  total
) {
  const n =
    Math.min(
      meta.rows.length,
      total.rows.length
    );

  const out = [];

  for (
    let i = 0;
    i < n;
    i++
  ) {
    const m =
      meta.rows[i] ||
      [];

    const x =
      total.rows[i] ||
      [];

    out.push({
      order:
        String(
          m[0] || ""
        ),

      position:
        String(
          m[1] || ""
        ),

      name:
        String(
          m[2] || ""
        ),

      seasonAvg:
        nnum(
          x[4]
        )
    });
  }

  return out;
}

function boxDetail(
  raw
) {
  if (!raw) {
    return null;
  }

  const hs =
    Array.isArray(
      raw.arrHitter
    )
      ? raw.arrHitter
      : [];

  const ps =
    Array.isArray(
      raw.arrPitcher
    )
      ? raw.arrPitcher
      : [];

  const team =
    (h, p) => ({
      hitters:
        hittersFromTables(
          tableJson(
            h &&
            h.table1
          ),
          tableJson(
            h &&
            h.table3
          )
        ),

      pitchers:
        pitchersFromTable(
          tableJson(
            p &&
            p.table
          )
        )
    });

  return {
    away:
      team(
        hs[0],
        ps[0]
      ),

    home:
      team(
        hs[1],
        ps[1]
      ),

    events: []
  };
}

function starters(
  arr
) {
  const seen =
    new Set();

  const out = [];

  for (
    const h of
    arr || []
  ) {
    const o =
      parseInt(
        h.order,
        10
      );

    if (
      !Number.isFinite(o) ||
      seen.has(o)
    ) {
      continue;
    }

    seen.add(o);

    out.push({
      order: o,
      position:
        h.position,
      name:
        h.name,
      seasonAvg:
        h.seasonAvg
    });
  }

  return out
    .sort(
      (a, b) =>
        a.order -
        b.order
    )
    .slice(
      0,
      9
    );
}

async function gameDetail(
  g
) {
  const seasonId =
    Number(
      (
        g.gameId ||
        ""
      ).slice(
        0,
        4
      )
    ) ||
    Number(
      todayKST().slice(
        0,
        4
      )
    );

  const p = {
    leId: 1,
    srId: 0,
    seasonId,
    gameId:
      g.gameId
  };

  const [s, b] =
    await Promise.all([
      postSchedule(
        "GetScoreBoardScroll",
        p
      ).catch(
        () => null
      ),

      postSchedule(
        "GetBoxScoreScroll",
        p
      ).catch(
        () => null
      )
    ]);

  const scoreboard =
    scoreDetail(s);

  const boxscore =
    boxDetail(b);

  const lineup =
    boxscore
      ? {
          announced:
            true,

          away: {
            slots:
              starters(
                boxscore
                  .away
                  .hitters
              )
          },

          home: {
            slots:
              starters(
                boxscore
                  .home
                  .hitters
              )
          }
        }
      : null;

  return {
    scoreboard,
    boxscore,
    lineup
  };
}

function gameSortKey(g) {
  return (
    `${g.date || ""}T` +
    `${g.time || "00:00"}`
  );
      }
export default {
  async fetch(
    request,
    env
  ) {
    const url =
      new URL(
        request.url
      );

    if (
      url.pathname !==
      "/api/kbo"
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
        q.type ||
        "standings";

      let payload = {
        updatedAt:
          new Date().toISOString()
      };

      /*
       * D-1 오늘 경기
       */
      /*
 * 임시 진단용:
 * KBO 과거 날짜 원본 확인
 */
if (
  type === "debug"
) {
  const date =
    String(
      q.date ||
      "2026-08-29"
    );

  const raw =
    await gameList(
      date
    );

  payload = {
    ...payload,
    date,
    raw
  };
}

else if (
  type === "score"
) {
        const date =
          todayKST();

        let games = [];

        try {
          games =
            (
              await gameList(
                date
              )
            )
              .map(
                x =>
                  publicGame(
                    x,
                    date
                  )
              )
              .filter(
                isLotte
              );
        }

        catch (e) {
          const month =
            date.slice(
              0,
              7
            );

          const scheduleHtml =
            await get(
              `${ENG}/Schedule/DailySchedule.aspx?searchDate=${month}`
            );

          games =
            parseScheduleGames(
              scheduleHtml,
              month
            ).filter(
              g =>
                g.date ===
                date
            );
        }

        payload = {
          ...payload,
          date,
          games
        };
      }

      /*
       * D-3
       * 최근 3경기 + 예정 3경기
       */
      else if (
        type === "schedule"
      ) {
        const current =
          currentMonthKST();

        /*
         * 예정 경기 검색용.
         * 이전 두 달도 읽어두지만
         * recent는 별도의 공식
         * 스코어보드 조회를 사용한다.
         */
        const months = [
          shiftMonth(
            current,
            -2
          ),

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

        /*
         * 새 recent 함수가
         * 실제 종료 경기 3개를
         * 스코어보드에서 가져온다.
         */
        const recent =
          await recentLotteFinalGames(
            today,
            3
          );

        /*
         * 예정 경기 정확히 3개
         */
        const upcoming =
          allGames
            .filter(
              g =>
                g.status ===
                  "예정" &&
                g.date >=
                  today
            )
            .slice(
              0,
              3
            );

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

      /*
       * D-1 경기 상세
       */
      else if (
        type === "game"
      ) {
        const gameId =
          String(
            q.gameId ||
            ""
          ).trim();

        if (!gameId) {
          throw new Error(
            "gameId가 없습니다."
          );
        }

        const date =
          normDate(
            gameId.slice(
              0,
              8
            )
          ) ||
          todayKST();

        const raw =
          (
            await gameList(
              date
            )
          ).find(
            x =>
              String(
                x.G_ID ||
                ""
              ) ===
              gameId
          );

        if (!raw) {
          throw new Error(
            "KBO 게임센터에서 해당 경기를 찾지 못했습니다."
          );
        }

        const game =
          publicGame(
            raw,
            date
          );

        payload = {
          ...payload,
          date,
          game,

          detail:
            await gameDetail(
              game
            )
        };
      }

      /*
       * D-3 리그 순위
       */
      else if (
        type ===
        "standings"
      ) {
        const html =
          await get(
            `${BASE}/Record/TeamRank/TeamRankDaily.aspx`
          );

        const ts =
          tables(html);

        const table =
          ts.find(
            t => {
              const h =
                t.headers.join(
                  " "
                );

              return (
                h.includes(
                  "순위"
                ) &&
                (
                  h.includes(
                    "팀명"
                  ) ||
                  h.includes(
                    "팀"
                  )
                )
              );
            }
          ) || null;

        payload = {
          ...payload,
          table
        };
      }

      /*
       * D-2 롯데 엔트리
       */
      else if (
        type ===
        "roster"
      ) {
        const html =
          await get(
            `${BASE}/Player/RegisterAll.aspx`
          );

        const groups =
          lotteRoster(
            html
          );

        payload = {
          ...payload,

          team:
            "롯데",

          groups,

          counts: {
            투수:
              groups[
                "투수"
              ].length,

            포수:
              groups[
                "포수"
              ].length,

            내야수:
              groups[
                "내야수"
              ].length,

            외야수:
              groups[
                "외야수"
              ].length
          }
        };
      }

      /*
       * D-2 선수 상세
       */
      else if (
        type ===
        "player"
      ) {
        const name =
          (
            q.name ||
            ""
          ).trim();

        const number =
          (
            q.number ||
            ""
          ).trim();

        const position =
          (
            q.position ||
            ""
          ).trim();

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
            BASE +
            found.path
          );

        payload = {
          ...payload,

          player:
            found,

          profile:
            parseProfile(
              html
            ),

          tables:
            seasonTables(
              html
            )
        };
      }

      else {
        throw new Error(
          "지원하지 않는 요청입니다."
        );
      }

      return new Response(
        JSON.stringify(
          payload
        ),
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
              : String(
                  error
                )
        }),
        {
          status: 500,
          headers
        }
      );
    }
  }
};
