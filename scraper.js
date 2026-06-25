const { chromium } = require('playwright');

const SPORT1_DARTS_URL = 'https://www.sport1.de/live/darts-sport';

async function createRenderedPage() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox'],
  });

  const page = await browser.newPage({
    viewport: { width: 1365, height: 1600 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  });

  return { browser, page };
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectStatus(text) {
  const value = normalizeText(text).toLowerCase();

  if (
    value.includes('live') ||
    value.includes('läuft') ||
    value.includes('aktuell')
  ) {
    return 'live';
  }

  if (
    value.includes('beendet') ||
    value.includes('endstand') ||
    value.includes('final') ||
    /\d+\s*:\s*\d+/.test(value)
  ) {
    return 'finished';
  }

  return 'scheduled';
}

function buildMatchId(match) {
  return [
    match.tournament,
    match.round,
    match.homeName,
    match.awayName,
    match.dateText,
    match.timeText,
  ]
    .map((part) =>
      normalizeText(part)
        .toLowerCase()
        .replace(/[^a-z0-9äöüß]+/gi, '-')
        .replace(/^-+|-+$/g, '')
    )
    .filter(Boolean)
    .join('_');
}

function parseScore(text) {
  const scoreMatch = normalizeText(text).match(/(\d+)\s*:\s*(\d+)/);

  if (!scoreMatch) {
    return {
      homeScore: null,
      awayScore: null,
      hasScore: false,
    };
  }

  return {
    homeScore: Number(scoreMatch[1]),
    awayScore: Number(scoreMatch[2]),
    hasScore: true,
  };
}

function guessTournamentFromText(text) {
  const value = normalizeText(text);

  const knownTournaments = [
    'Slovak Darts Open',
    'Nordic Darts Masters',
    'International Darts Open',
    'European Darts Open',
    'European Darts Grand Prix',
    'World Matchplay',
    'World Cup of Darts',
    'Premier League',
    'UK Open',
    'World Darts Championship',
    'Players Championship',
    'World Grand Prix',
    'Grand Slam of Darts',
    'European Championship',
  ];

  for (const tournament of knownTournaments) {
    if (value.toLowerCase().includes(tournament.toLowerCase())) {
      return tournament;
    }
  }

  return 'PDC Darts';
}

function guessRoundFromText(text) {
  const value = normalizeText(text).toLowerCase();

  if (value.includes('finale') && !value.includes('halbfinale')) {
    return 'Finale';
  }

  if (value.includes('halbfinale')) {
    return 'Halbfinale';
  }

  if (value.includes('viertelfinale')) {
    return 'Viertelfinale';
  }

  if (value.includes('achtelfinale')) {
    return 'Achtelfinale';
  }

  if (value.includes('sechzehntelfinale')) {
    return 'Sechzehntelfinale';
  }

  if (value.includes('1. runde') || value.includes('erste runde')) {
    return '1. Runde';
  }

  if (value.includes('2. runde') || value.includes('zweite runde')) {
    return '2. Runde';
  }

  if (value.includes('3. runde') || value.includes('dritte runde')) {
    return '3. Runde';
  }

  return 'Spiel';
}

function extractNamesFromLine(line) {
  const text = normalizeText(line);

  const separators = [
    /\s+vs\.?\s+/i,
    /\s+v\s+/i,
    /\s+-\s+/i,
    /\s+gegen\s+/i,
  ];

  for (const separator of separators) {
    const parts = text.split(separator).map(normalizeText);

    if (parts.length >= 2 && parts[0] && parts[1]) {
      return {
        homeName: parts[0].replace(/\d+\s*:\s*\d+/g, '').trim(),
        awayName: parts[1].replace(/\d+\s*:\s*\d+/g, '').trim(),
      };
    }
  }

  return null;
}

function isUsefulMatchLine(line) {
  const text = normalizeText(line);

  if (!text) return false;
  if (text.length < 8) return false;

  return (
    /\s+vs\.?\s+/i.test(text) ||
    /\s+v\s+/i.test(text) ||
    /\s+-\s+/i.test(text) ||
    /\s+gegen\s+/i.test(text)
  );
}

function parseMatchesFromText(pageText) {
  const lines = pageText
    .split('\n')
    .map(normalizeText)
    .filter(Boolean);

  const matches = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    if (!isUsefulMatchLine(line)) {
      continue;
    }

    const names = extractNamesFromLine(line);

    if (!names || !names.homeName || !names.awayName) {
      continue;
    }

    const contextLines = lines.slice(Math.max(0, i - 6), i + 7);
    const contextText = contextLines.join(' ');
    const score = parseScore(contextText);
    const status = detectStatus(contextText);

    const match = {
      id: '',
      source: 'sport1',
      tournament: guessTournamentFromText(contextText),
      round: guessRoundFromText(contextText),
      status,
      homeName: names.homeName,
      awayName: names.awayName,
      homeScore: score.homeScore,
      awayScore: score.awayScore,
      hasScore: score.hasScore,
      dateText: '',
      timeText: '',
      rawText: contextText,
      updatedAt: new Date().toISOString(),
    };

    match.id = buildMatchId(match);

    if (
      match.homeName.length > 1 &&
      match.awayName.length > 1 &&
      !matches.some((existing) => existing.id === match.id)
    ) {
      matches.push(match);
    }
  }

  return matches;
}

function splitMatchesByStatus(matches) {
  return {
    current: matches.filter((match) => match.status === 'live'),
    scheduled: matches.filter((match) => match.status === 'scheduled'),
    finished: matches.filter((match) => match.status === 'finished'),
  };
}

async function getRenderedSport1Text() {
  const { browser, page } = await createRenderedPage();

  try {
    await page.goto(SPORT1_DARTS_URL, {
      waitUntil: 'networkidle',
      timeout: 60000,
    });

    await page.waitForTimeout(2500);

    const text = await page.locator('body').innerText({
      timeout: 15000,
    });

    return normalizeText(text).replace(/\s{2,}/g, '\n');
  } finally {
    await browser.close();
  }
}

async function getLiveDartsData() {
  const renderedText = await getRenderedSport1Text();
  const matches = parseMatchesFromText(renderedText);
  const grouped = splitMatchesByStatus(matches);

  return {
    source: 'sport1',
    status: 'ok',
    lastUpdated: new Date().toISOString(),
    total: matches.length,
    matches,
    current: grouped.current,
    scheduled: grouped.scheduled,
    finished: grouped.finished,
  };
}

async function getSport1DebugText() {
  const renderedText = await getRenderedSport1Text();

  return {
    source: 'sport1',
    url: SPORT1_DARTS_URL,
    lastUpdated: new Date().toISOString(),
    textLength: renderedText.length,
    text: renderedText,
  };
}

module.exports = {
  getLiveDartsData,
  getSport1DebugText,
};
