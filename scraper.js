const { chromium } = require('playwright');

const SPORT1_DARTS_URL = 'https://www.sport1.de/live/darts-sport';

const CACHE_DURATION_MS = 30 * 1000;
const STALE_CACHE_MAX_AGE_MS = 10 * 60 * 1000;

const TOURNAMENT_RULES = [
  {
    name: 'Slovak Darts Open',
    aliases: ['Slovak Darts Open'],
    defaultBestOfLegs: 11,
    defaultTargetLegs: 6,
    rounds: {
      '1. Runde': {
        order: 40,
        bestOfLegs: 11,
        targetLegs: 6,
      },
      '2. Runde': {
        order: 50,
        bestOfLegs: 11,
        targetLegs: 6,
      },
      Sechzehntelfinale: {
        order: 50,
        bestOfLegs: 11,
        targetLegs: 6,
      },
      Achtelfinale: {
        order: 60,
        bestOfLegs: 11,
        targetLegs: 6,
      },
      Viertelfinale: {
        order: 70,
        bestOfLegs: 11,
        targetLegs: 6,
      },
      Halbfinale: {
        order: 80,
        bestOfLegs: 13,
        targetLegs: 7,
      },
      Finale: {
        order: 90,
        bestOfLegs: 15,
        targetLegs: 8,
      },
    },
  },
];

let cachedData = null;
let cachedAt = 0;
let runningRequest = null;

async function getLiveDartsData() {
  const now = Date.now();
  const hasFreshCache = cachedData && now - cachedAt < CACHE_DURATION_MS;
  const hasUsableStaleCache =
    cachedData && now - cachedAt < STALE_CACHE_MAX_AGE_MS;

  if (hasFreshCache) {
    return {
      ...cachedData,
      fromCache: true,
      staleCache: false,
      updatingInBackground: false,
    };
  }

  if (hasUsableStaleCache) {
    startBackgroundRefresh();

    return {
      ...cachedData,
      fromCache: true,
      staleCache: true,
      updatingInBackground: true,
    };
  }

  if (runningRequest) {
    return runningRequest;
  }

  return refreshCacheNow();
}

function startBackgroundRefresh() {
  if (runningRequest) {
    return;
  }

  runningRequest = scrapeLiveDartsData()
    .then((data) => {
      cachedData = data;
      cachedAt = Date.now();
      return data;
    })
    .catch((error) => {
      console.error('Background refresh fehlgeschlagen:', error.message);
      return cachedData;
    })
    .finally(() => {
      runningRequest = null;
    });
}

async function refreshCacheNow() {
  runningRequest = scrapeLiveDartsData()
    .then((data) => {
      cachedData = data;
      cachedAt = Date.now();
      return data;
    })
    .finally(() => {
      runningRequest = null;
    });

  return runningRequest;
}

async function scrapeLiveDartsData() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage({
      viewport: {
        width: 1280,
        height: 900,
      },
    });

    await page.route('**/*', async (route) => {
      const resourceType = route.request().resourceType();

      if (['image', 'font', 'media'].includes(resourceType)) {
        await route.abort();
        return;
      }

      await route.continue();
    });

    await page.goto(SPORT1_DARTS_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });

    await page.waitForTimeout(1800);

    const allMatches = [];

    const firstPageData = await scrapeCurrentPage(page, 0);
    allMatches.push(...firstPageData.matches);

    const dateLabels = buildDateClickOrder(firstPageData.dateLabels);

    for (let dateIndex = 0; dateIndex < dateLabels.length; dateIndex++) {
      const dateLabel = dateLabels[dateIndex];

      const clicked = await clickDateLabel(page, dateLabel);

      if (!clicked) {
        continue;
      }

      await page.waitForTimeout(900);

      const pageData = await scrapeCurrentPage(page, dateIndex + 1);
      allMatches.push(...pageData.matches);
    }

    const matches = removeDuplicateMatches(allMatches)
      .sort(sortMatches)
      .map((match, index) => ({
        ...match,
        globalOrder: index + 1,
      }));

    return {
      lastUpdate: new Date().toISOString(),
      source: 'sport1',
      experimental: true,
      mode: 'playwright-visible-text-multi-date-cached',
      url: SPORT1_DARTS_URL,

      matchCount: matches.length,
      liveMatches: matches.filter((match) => match.status === 'live').length,
      scheduledMatches: matches.filter((match) => match.status === 'scheduled')
        .length,
      finishedMatches: matches.filter((match) => match.status === 'finished')
        .length,
      hasLiveMatches: matches.some((match) => match.status === 'live'),

      availableDates: dateLabels,
      fromCache: false,
      staleCache: false,
      updatingInBackground: false,
      cacheDurationMs: CACHE_DURATION_MS,
      staleCacheMaxAgeMs: STALE_CACHE_MAX_AGE_MS,

      matches,
    };
  } finally {
    await browser.close();
  }
}

async function scrapeCurrentPage(page, dateIndex) {
  const pageText = await page.locator('body').innerText();

  const lines = pageText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const dateLabels = extractDateLabels(lines);
  const currentDateLabel = guessCurrentDateLabel(lines, dateLabels);

  const matches = parseSport1DartsMatches(lines, {
    dateIndex,
    dateLabel: currentDateLabel,
  });

  return {
    dateLabels,
    currentDateLabel,
    preview: lines,
    matches,
  };
}

async function clickDateLabel(page, dateLabel) {
  try {
    const candidates = page.locator('button, a, [role="button"]').filter({
      hasText: dateLabel,
    });

    const count = await candidates.count();

    if (count === 0) {
      return false;
    }

    for (let index = 0; index < count; index++) {
      const candidate = candidates.nth(index);

      try {
        if (!(await candidate.isVisible())) {
          continue;
        }

        await candidate.click({
          timeout: 4000,
        });

        return true;
      } catch (_) {
        continue;
      }
    }

    return false;
  } catch (_) {
    return false;
  }
}

function parseSport1DartsMatches(lines, options = {}) {
  const matches = [];

  let currentTournament = 'Darts';
  let currentRound = null;
  let currentDateLabel = options.dateLabel || null;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];

    if (isDateLabel(line)) {
      currentDateLabel = line;
      continue;
    }

    if (isTournamentName(line)) {
      currentTournament = line;
      continue;
    }

    if (isRoundName(line)) {
      currentRound = line;
      continue;
    }

    if (line !== '') {
      continue;
    }

    const values = [];
    let offset = 1;

    while (index + offset < lines.length) {
      const value = lines[index + offset];

      if (value === '') {
        break;
      }

      if (isTournamentName(value)) {
        currentTournament = value;
        offset++;
        continue;
      }

      if (isRoundName(value)) {
        currentRound = value;
        offset++;
        continue;
      }

      if (!isIcon(value) && !isDateLabel(value)) {
        values.push(value);
      }

      offset++;
    }

    const centerIndex = values.findIndex(
      (value) => isScore(value) || isStartTime(value),
    );

    if (centerIndex <= 0 || centerIndex >= values.length - 1) {
      continue;
    }

    const player1 = values[centerIndex - 1];
    const center = values[centerIndex];
    const player2 = values[centerIndex + 1];

    if (!isValidPlayerName(player1) || !isValidPlayerName(player2)) {
      continue;
    }

    const roundInfo = getRoundInfo(currentRound, currentTournament);
    const legs = isScore(center) ? normalizeScore(center) : '0-0';
    const scoreParts = parseScoreParts(legs);
    const status = determineStatus(center, currentRound, currentTournament);
    const matchOrder = matches.length + 1;

    matches.push({
      id: createMatchId(player1, player2, center, currentDateLabel),

      tournament: currentTournament,
      tournamentName: currentTournament,

      tournamentRuleName: roundInfo.tournamentRuleName,
      hasTournamentRule: roundInfo.hasTournamentRule,

      round: roundInfo.title,
      roundName: roundInfo.title,
      roundOrder: roundInfo.order,

      dateLabel: currentDateLabel,
      dateIndex: options.dateIndex ?? 0,

      matchOrder,
      bracketPosition: matchOrder,

      player1,
      player2,
      homeName: formatPlayerName(player1),
      awayName: formatPlayerName(player2),

      player1DisplayName: formatPlayerName(player1),
      player2DisplayName: formatPlayerName(player2),

      startTime: isStartTime(center) ? center : null,

      sets: null,

      legs,
      legs1: scoreParts.left,
      legs2: scoreParts.right,

      homeScore: status === 'scheduled' ? null : String(scoreParts.left),
      awayScore: status === 'scheduled' ? null : String(scoreParts.right),

      targetLegs: roundInfo.targetLegs,
      bestOfLegs: roundInfo.bestOfLegs,

      scoreText: center,

      status,

      isLive: status === 'live',
      isScheduled: status === 'scheduled',
      isFinished: status === 'finished',

      winner: determineWinner(player1, player2, status, scoreParts),
      winnerDisplayName: determineWinnerDisplayName(
        player1,
        player2,
        status,
        scoreParts,
      ),
    });
  }

  return matches;
}

function extractDateLabels(lines) {
  const labels = [];

  for (const line of lines) {
    if (!isDateLabel(line)) {
      continue;
    }

    if (!labels.includes(line)) {
      labels.push(line);
    }
  }

  return labels;
}

function buildDateClickOrder(foundLabels) {
  const preferred = [
    'Mo',
    'Di',
    'Mi',
    'Do',
    'Fr',
    'Sa',
    'So',
    'Gestern',
    'Heute',
    'Morgen',
  ];

  const result = [];

  for (const label of preferred) {
    if (foundLabels.includes(label) && !result.includes(label)) {
      result.push(label);
    }
  }

  for (const label of foundLabels) {
    if (!result.includes(label)) {
      result.push(label);
    }
  }

  return result;
}

function guessCurrentDateLabel(lines, dateLabels) {
  if (dateLabels.length === 0) {
    return null;
  }

  const todayIndex = dateLabels.findIndex((label) =>
    label.toLowerCase().includes('heute'),
  );

  if (todayIndex >= 0) {
    return dateLabels[todayIndex];
  }

  return dateLabels[0];
}

function removeDuplicateMatches(matches) {
  const seen = new Set();
  const result = [];

  for (const match of matches) {
    const key = [
      normalizeCompare(match.tournament),
      normalizeCompare(match.round || ''),
      normalizeCompare(match.player1),
      normalizeCompare(match.player2),
      match.scoreText,
      match.dateLabel || '',
    ].join('|');

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(match);
  }

  return result;
}

function sortMatches(a, b) {
  const tournamentCompare = normalizeCompare(a.tournament).localeCompare(
    normalizeCompare(b.tournament),
  );

  if (tournamentCompare !== 0) {
    return tournamentCompare;
  }

  if (a.roundOrder !== b.roundOrder) {
    return a.roundOrder - b.roundOrder;
  }

  if ((a.dateIndex ?? 0) !== (b.dateIndex ?? 0)) {
    return (a.dateIndex ?? 0) - (b.dateIndex ?? 0);
  }

  if ((a.matchOrder ?? 0) !== (b.matchOrder ?? 0)) {
    return (a.matchOrder ?? 0) - (b.matchOrder ?? 0);
  }

  return normalizeCompare(a.id).localeCompare(normalizeCompare(b.id));
}

function isTournamentName(value) {
  if (!value) {
    return false;
  }

  return (
    value.includes('Darts Open') ||
    value.includes('Players Championship') ||
    value.includes('World Matchplay') ||
    value.includes('World Championship') ||
    value.includes('Masters') ||
    value.includes('Premier League') ||
    value.includes('Grand Prix') ||
    value.includes('Grand Slam')
  );
}

function isRoundName(value) {
  if (!value) {
    return false;
  }

  const text = value.toLowerCase();

  return (
    text.includes('runde') ||
    text.includes('finale') ||
    text.includes('sechzehntelfinale') ||
    text.includes('achtelfinale') ||
    text.includes('viertelfinale') ||
    text.includes('halbfinale')
  );
}

function isDateLabel(value) {
  if (!value) {
    return false;
  }

  const text = value.trim();

  if (['Heute', 'Morgen', 'Gestern'].includes(text)) {
    return true;
  }

  if (/^(Mo|Di|Mi|Do|Fr|Sa|So)\.?$/i.test(text)) {
    return true;
  }

  if (/^(Mo|Di|Mi|Do|Fr|Sa|So)\.?\s+\d{1,2}\.\d{1,2}\.?$/i.test(text)) {
    return true;
  }

  if (/^\d{1,2}\.\d{1,2}\.?$/.test(text)) {
    return true;
  }

  if (/^\d{1,2}\.\d{1,2}\.\d{2,4}$/.test(text)) {
    return true;
  }

  return false;
}

function isValidPlayerName(value) {
  if (!value) {
    return false;
  }

  if (value.length < 3) {
    return false;
  }

  if (isIcon(value)) {
    return false;
  }

  if (isScore(value)) {
    return false;
  }

  if (isStartTime(value)) {
    return false;
  }

  if (isWeekday(value)) {
    return false;
  }

  if (isDateNumber(value)) {
    return false;
  }

  if (isDateLabel(value)) {
    return false;
  }

  const blocked = [
    'Home',
    'LOGIN',
    'DARTS',
    'Spielplan',
    'SPORTARTEN',
    'SOCIAL MEDIA',
    'SERVICE',
    'MEHR',
    'ÜBER UNS',
    'N. N.',
    'LIVE',
    'Ergebnisse',
    'Darts Heute LIVE',
  ];

  if (blocked.includes(value)) {
    return false;
  }

  return /[A-Za-zÄÖÜäöüß]/.test(value);
}

function isScore(value) {
  if (!value) {
    return false;
  }

  if (isStartTime(value)) {
    return false;
  }

  return /^\d+\s*:\s*\d+$/.test(value);
}

function isStartTime(value) {
  if (!value) {
    return false;
  }

  return /^\d{1,2}:\d{2}$/.test(value);
}

function normalizeScore(value) {
  return value.replace(/\s+/g, '').replace(':', '-');
}

function parseScoreParts(score) {
  const parts = score.split('-');

  return {
    left: parseInt(parts[0] || '0', 10),
    right: parseInt(parts[1] || '0', 10),
  };
}

function determineStatus(value, roundName, tournamentName) {
  if (isStartTime(value)) {
    return 'scheduled';
  }

  if (!isScore(value)) {
    return 'unknown';
  }

  const tournamentRule = getTournamentRule(tournamentName);

  if (!tournamentRule) {
    return 'live';
  }

  const score = normalizeScore(value);
  const parts = parseScoreParts(score);
  const roundInfo = getRoundInfo(roundName, tournamentName);

  if (parts.left >= roundInfo.targetLegs || parts.right >= roundInfo.targetLegs) {
    return 'finished';
  }

  return 'live';
}

function getRoundInfo(roundName, tournamentName) {
  const title = normalizeRoundTitle(roundName);
  const tournamentRule = getTournamentRule(tournamentName);

  if (tournamentRule) {
    const roundRule =
      tournamentRule.rounds[title] ??
      tournamentRule.rounds[normalizeRoundTitle(title)];

    if (roundRule) {
      return {
        title,
        order: roundRule.order,
        bestOfLegs: roundRule.bestOfLegs,
        targetLegs: roundRule.targetLegs,
        hasTournamentRule: true,
        tournamentRuleName: tournamentRule.name,
      };
    }

    return {
      title,
      order: 999,
      bestOfLegs: tournamentRule.defaultBestOfLegs,
      targetLegs: tournamentRule.defaultTargetLegs,
      hasTournamentRule: true,
      tournamentRuleName: tournamentRule.name,
    };
  }

  return {
    title,
    order: defaultRoundOrder(title),
    bestOfLegs: null,
    targetLegs: null,
    hasTournamentRule: false,
    tournamentRuleName: null,
  };
}

function getTournamentRule(tournamentName) {
  const tournament = normalizeCompare(tournamentName);

  if (!tournament) {
    return null;
  }

  for (const rule of TOURNAMENT_RULES) {
    const names = [rule.name, ...(rule.aliases || [])];

    for (const name of names) {
      const normalizedName = normalizeCompare(name);

      if (
        tournament === normalizedName ||
        tournament.includes(normalizedName) ||
        normalizedName.includes(tournament)
      ) {
        return rule;
      }
    }
  }

  return null;
}

function defaultRoundOrder(title) {
  const text = title.toLowerCase();

  if (text === '1. runde') return 40;
  if (text === '2. runde') return 50;
  if (text === 'sechzehntelfinale') return 50;
  if (text === 'achtelfinale') return 60;
  if (text === 'viertelfinale') return 70;
  if (text === 'halbfinale') return 80;
  if (text === 'finale') return 90;

  return 999;
}

function normalizeRoundTitle(value) {
  if (!value) {
    return 'Spiele';
  }

  const text = value.toLowerCase().trim();

  if (text.includes('1. runde') || text.includes('runde 1')) {
    return '1. Runde';
  }

  if (text.includes('2. runde') || text.includes('runde 2')) {
    return '2. Runde';
  }

  if (text.includes('sechzehntelfinale')) {
    return 'Sechzehntelfinale';
  }

  if (text.includes('achtelfinale')) {
    return 'Achtelfinale';
  }

  if (text.includes('viertelfinale')) {
    return 'Viertelfinale';
  }

  if (text.includes('halbfinale')) {
    return 'Halbfinale';
  }

  if (text === 'finale' || text.includes('finale')) {
    return 'Finale';
  }

  return value.trim();
}

function determineWinner(player1, player2, status, scoreParts) {
  if (status !== 'finished') {
    return null;
  }

  if (scoreParts.left > scoreParts.right) {
    return player1;
  }

  if (scoreParts.right > scoreParts.left) {
    return player2;
  }

  return null;
}

function determineWinnerDisplayName(player1, player2, status, scoreParts) {
  const winner = determineWinner(player1, player2, status, scoreParts);

  if (!winner) {
    return null;
  }

  return formatPlayerName(winner);
}

function formatPlayerName(value) {
  if (!value.includes(',')) {
    return value;
  }

  const parts = value.split(',');

  if (parts.length < 2) {
    return value;
  }

  const lastName = parts[0].trim();
  const firstName = parts[1].trim();

  if (!lastName || !firstName) {
    return value;
  }

  return `${firstName} ${lastName}`;
}

function createMatchId(player1, player2, center, dateLabel) {
  return `${dateLabel || 'date'}-${player1}-${player2}-${center}`
    .toLowerCase()
    .replace(/[^a-z0-9äöüß]+/gi, '-')
    .replace(/^-+|-+$/g, '');
}

function isWeekday(value) {
  return [
    'Mo',
    'Di',
    'Mi',
    'Do',
    'Fr',
    'Sa',
    'So',
    'Heute',
  ].includes(value);
}

function isDateNumber(value) {
  return /^\d{1,2}$/.test(value);
}

function isIcon(value) {
  if (!value) {
    return false;
  }

  return /^[^\w\dA-Za-zÄÖÜäöüß]+$/.test(value);
}

function normalizeCompare(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9äöüß]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = {
  getLiveDartsData,
};