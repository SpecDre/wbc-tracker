const NAME_TO_ABB = {
  "puerto rico":"PUR","canada":"CAN","colombia":"COL","cuba":"CUB","panama":"PAN",
  "united states":"USA","usa":"USA","u.s.a.":"USA","mexico":"MEX","italy":"ITA",
  "great britain":"GBR","brazil":"BRA","japan":"JPN","south korea":"KOR","korea":"KOR",
  "australia":"AUS","chinese taipei":"TPE","taiwan":"TPE","czech republic":"CZE","czechia":"CZE",
  "dominican republic":"DOM","venezuela":"VEN","netherlands":"NED","kingdom of the netherlands":"NED","nicaragua":"NCA","israel":"ISR",
};

const POOL_MAP = {
  PUR:"A",CAN:"A",COL:"A",CUB:"A",PAN:"A",
  USA:"B",MEX:"B",ITA:"B",GBR:"B",BRA:"B",
  JPN:"C",KOR:"C",AUS:"C",TPE:"C",CZE:"C",
  DOM:"D",VEN:"D",NED:"D",NCA:"D",ISR:"D",
};

function toAbb(name, abbr) {
  if (abbr && POOL_MAP[abbr]) return abbr;
  if (!name) return null;
  return NAME_TO_ABB[name.toLowerCase().trim()] || null;
}

async function getLiveFeed(gameId) {
  try {
    const r = await fetch(`https://statsapi.mlb.com/api/v1.1/game/${gameId}/feed/live`, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const data = await r.json();
    const ls = data.liveData?.linescore;
    const plays = data.liveData?.plays;
    const allPlays = plays?.allPlays || [];
    const lastPlayDesc = allPlays.length > 0 ? allPlays[allPlays.length - 1]?.result?.description || null : null;
    const pitcherId = ls?.defense?.pitcher?.id;
    const homeBox = data.liveData?.boxscore?.teams?.home;
    const awayBox = data.liveData?.boxscore?.teams?.away;
    const pitcherData = (homeBox?.players?.["ID" + pitcherId]) || (awayBox?.players?.["ID" + pitcherId]);
    const ps = pitcherData?.stats?.pitching;
    const pitcherStats = ps ? { ip: ps.inningsPitched || "0.0", k: ps.strikeOuts || 0, er: ps.earnedRuns || 0, pitches: ps.numberOfPitches || 0 } : null;
    const innings = (ls?.innings || []).map(i => ({ num: i.num, away: i.away?.runs ?? null, home: i.home?.runs ?? null }));
    return {
      inning: ls?.currentInning || null, inningOrdinal: ls?.currentInningOrdinal || null,
      inningHalf: ls?.inningState || null, outs: ls?.outs ?? null, balls: ls?.balls ?? null,
      strikes: ls?.strikes ?? null, batter: ls?.offense?.batter?.fullName || null,
      pitcher: ls?.defense?.pitcher?.fullName || null, onDeck: ls?.offense?.onDeck?.fullName || null,
      inHole: ls?.offense?.inHole?.fullName || null, first: ls?.offense?.first?.fullName || null,
      second: ls?.offense?.second?.fullName || null, third: ls?.offense?.third?.fullName || null,
      awayHits: ls?.teams?.away?.hits ?? null, homeHits: ls?.teams?.home?.hits ?? null,
      lastPlay: lastPlayDesc, pitcherStats, innings,
    };
  } catch(e) { return null; }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "s-maxage=10, stale-while-revalidate=20");
  try {
    const today = new Date().toISOString().split("T")[0];
    const allGames = [], seen = new Set();
    const urls = [
      `https://statsapi.mlb.com/api/v1/schedule?sportId=51&startDate=2026-03-05&endDate=2026-03-17&hydrate=team,linescore`,
      `https://statsapi.mlb.com/api/v1/schedule?sportId=23&startDate=2026-03-05&endDate=2026-03-17&hydrate=team,linescore`,
      `https://statsapi.mlb.com/api/v1/schedule?sportId=17&startDate=2026-03-05&endDate=2026-03-17&hydrate=team,linescore`,
      `https://statsapi.mlb.com/api/v1/schedule?sportId=1&gameType=W&startDate=2026-03-05&endDate=2026-03-17&hydrate=team,linescore`,
      `https://statsapi.mlb.com/api/v1/schedule?leagueId=159&startDate=2026-03-05&endDate=2026-03-17&hydrate=team,linescore`,
    ];
    for (const url of urls) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!r.ok) continue;
        const data = await r.json();
        for (const d of (data.dates || [])) {
          for (const game of (d.games || [])) {
            const awayRaw = game.teams?.away?.team, homeRaw = game.teams?.home?.team;
            const away = toAbb(awayRaw?.name, awayRaw?.abbreviation);
            const home = toAbb(homeRaw?.name, homeRaw?.abbreviation);
            if (!away || !home || !POOL_MAP[away] || !POOL_MAP[home]) continue;
            const key = `${away}-${home}-${(game.gameDate||"").split("T")[0]}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const abs = game.status?.abstractGameState, det = game.status?.detailedState || "";
            let status = "upcoming";
            if (abs === "Final") status = "final";
            else if (abs === "Live" || det.includes("Progress")) status = "live";
            allGames.push({ gameId: game.gamePk, away, home,
              awayScore: status !== "upcoming" ? (game.teams?.away?.score ?? null) : null,
              homeScore: status !== "upcoming" ? (game.teams?.home?.score ?? null) : null,
              status, startTime: game.gameDate, pool: POOL_MAP[away] });
          }
        }
      } catch(e) {}
    }
    const liveGames = allGames.filter(g => g.status === "live");
    if (liveGames.length > 0) {
      const feeds = await Promise.all(liveGames.map(g => getLiveFeed(g.gameId)));
      liveGames.forEach((game, i) => { if (feeds[i]) game.linescore = feeds[i]; });
    }
    allGames.sort((a,b) => new Date(a.startTime) - new Date(b.startTime));
    res.status(200).json({ games: allGames, count: allGames.length, fetchedAt: new Date().toISOString(), today });
  } catch(err) { res.status(500).json({ error: err.message }); }
}
