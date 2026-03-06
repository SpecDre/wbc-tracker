const WBC_TEAMS = new Set([
  "PUR","CAN","COL","CUB","PAN",
  "USA","MEX","ITA","GBR","BRA",
  "JPN","KOR","AUS","TPE","CZE",
  "DOM","VEN","NED","NCA","ISR"
]);

const POOL_MAP = {
  PUR:"A", CAN:"A", COL:"A", CUB:"A", PAN:"A",
  USA:"B", MEX:"B", ITA:"B", GBR:"B", BRA:"B",
  JPN:"C", KOR:"C", AUS:"C", TPE:"C", CZE:"C",
  DOM:"D", VEN:"D", NED:"D", NCA:"D", ISR:"D",
};

// Date range for the WBC tournament
function getWbcDates() {
  const dates = [];
  const start = new Date("2026-03-05");
  const end   = new Date("2026-03-17");
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    dates.push(d.toISOString().split("T")[0]);
  }
  return dates;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");

  try {
    // Fetch scores from the public MLB Stats API (no key needed)
    const dates = getWbcDates();
    const today = new Date().toISOString().split("T")[0];

    // Focus on today ± 1 day to keep it fast
    const relevantDates = dates.filter(d => {
      const diff = (new Date(d) - new Date(today)) / 86400000;
      return diff >= -3 && diff <= 3;
    });

    const allGames = [];

    await Promise.all(relevantDates.map(async (date) => {
      try {
        const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}&hydrate=team,linescore`;
        const r = await fetch(url);
        const data = await r.json();
        const dates = data.dates || [];
        for (const d of dates) {
          for (const game of (d.games || [])) {
            const away = game.teams?.away?.team?.abbreviation;
            const home = game.teams?.home?.team?.abbreviation;
            if (!WBC_TEAMS.has(away) || !WBC_TEAMS.has(home)) continue;

            const status = game.status?.abstractGameState; // "Preview", "Live", "Final"
            const awayScore = game.teams?.away?.score ?? null;
            const homeScore = game.teams?.home?.score ?? null;

            let gameStatus = "upcoming";
            if (status === "Final") gameStatus = "final";
            else if (status === "Live") gameStatus = "live";

            allGames.push({
              id: game.gamePk,
              away,
              home,
              awayScore: awayScore !== undefined ? awayScore : null,
              homeScore: homeScore !== undefined ? homeScore : null,
              status: gameStatus,
              startTime: game.gameDate,
              pool: POOL_MAP[away] || "?",
            });
          }
        }
      } catch (e) {
        // skip failed dates silently
      }
    }));

    // Sort by start time
    allGames.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));

    res.status(200).json({ games: allGames, fetchedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
