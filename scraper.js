const { chromium } = require('playwright');

const SPORT1_DARTS_URL = 'https://www.sport1.de/live/darts-sport';

async function createRenderedPage() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
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

function normalizeKey(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9äöüß]+/gi, '-')
    .replace(/^-+|-+$/g, '');
}

async function openSport1Page(page) {
  await page.goto(SPORT1_DARTS_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });

  await page.waitForTimeout(3000);
}

async function getVisibleBodyText(page) {
  return await page.evaluate(() => {
    return document.body ? document.body.innerText || document.body.textContent || '' : '';
  });
}

function extractDateLabelsFromText(text) {
  const value = normalizeText(text);
  const labels = [];
  const regex = /\b(Mo|Di|Mi|Do|Fr|Sa|So)\s+\d{1,2}\b|\bHeute\b|\bMorgen\b|\bGestern\b/g;

  let match;

  while ((match = regex.exec(value)) !== null) {
    const label = normalizeText(match[0]);

    if (!labels.includes(label)) {
      labels.push(label);
    }
  }

  return sortDateLabels(labels);
}

function sortDateLabels(labels) {
  const unique = [...new Set(labels)];
  const todayIndex = unique.findIndex((label) => label === 'Heute');

  if (todayIndex < 0) {
    return unique;
  }

  return [...unique.slice(todayIndex), ...unique.slice(0, todayIndex)];
}

async function clickDateTab(page, dateLabel) {
  try {
    const locator = page.getByText(dateLabel, { exact: true });
    const count = await locator.count();

    for (let index = 0; index < count; index += 1) {
      const item = locator.nth(index);

      try {
        if (!(await item.isVisible())) {
          continue;
        }

        await item.click({ timeout: 5000 });
        await page.waitForTimeout(1500);
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
    /\d+\s*:\s*\d+/.test(value)
  ) {
    return 'finished';
  }

  return 'scheduled';
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

function extractTimeFromText(text) {
  const match = normalizeText(text).match(/\b\d{1,2}:\d{2}\b/);
  return match ? match[0] : '';
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

  if (value.includes('sechzehntelfinale')) return 'Sechzehntelfinale';
  if (value.includes('achtelfinale')) return 'Achtelfinale';
  if (value.includes('viertelfinale')) return 'Viertelfinale';
  if (value.includes('halbfinale')) return 'Halbfinale';
  if (value.includes('finale')) return 'Finale';
  if (value.includes('1. runde') || value.includes('erste runde')) return '1. Runde';
  if (value.includes('2. runde') || value.includes('zweite runde')) return '2. Runde';
  if (value.includes('3. runde') || value.includes('dritte runde')) return '3. Runde';

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
        homeName: parts[0]
          .replace(/\d+\s*:\s*\d+/g, '')
          .replace(/\b\d{1,2}:\d{2}\b/g, '')
          .trim(),
        awayName: parts[1]
          .replace(/\d+\s*:\s*\d+/g, '')
          .replace(/\b\d{1,2}:\d{2}\b/g, '')
          .trim(),
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

function buildMatchId(match) {
  return [
    match.dateText,
    match.tournament,
    match.round,
    match.homeName,
    match.awayName,
    match.timeText,
    match.scoreText,
  ]
    .map(normalizeKey)
    .filter(Boolean)
    .join('_');
}

function parseMatchesFromText(pageText, dateText = '') {
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

    const contextLines = lines.slice(Math.max(0, i - 8), i + 9);
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
      dateText,
      timeText: extractTimeFromText(contextText),
      scoreText: score.hasScore ? `${score.homeScore}:${score.awayScore}` : '',
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

function removeDuplicateMatches(matches) {
  const seen = new Set();
  const result = [];

  for (const match of matches) {
    const key = [
      match.dateText,
      match.tournament,
      match.round,
      match.homeName,
      match.awayName,
      match.timeText,
      match.scoreText,
    ]
      .map(normalizeKey)
      .join('|');

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(match);
  }

  return result;
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
    await openSport1Page(page);

    const text = await getVisibleBodyText(page);

    return normalizeText(text).replace(/\s{2,}/g, '\n');
  } finally {
    await browser.close();
  }
}

async function getRenderedSport1TextsByDate() {
  const { browser, page } = await createRenderedPage();

  try {
    await openSport1Page(page);

    const firstText = await getVisibleBodyText(page);
    const dateTabs = extractDateLabelsFromText(firstText);

    const results = [
      {
        dateText: dateTabs.includes('Heute') ? 'Heute' : dateTabs[0] || '',
        clicked: false,
        text: firstText,
      },
    ];

    for (const dateLabel of dateTabs) {
      if (results.some((result) => result.dateText === dateLabel)) {
        continue;
      }

      const clicked = await clickDateTab(page, dateLabel);

      if (!clicked) {
        continue;
      }

      const text = await getVisibleBodyText(page);

      results.push({
        dateText: dateLabel,
        clicked: true,
        text,
      });
    }

    return {
      dateTabs,
      results,
    };
  } finally {
    await browser.close();
  }
}

async function getLiveDartsData() {
  const rendered = await getRenderedSport1TextsByDate();

  const matches = removeDuplicateMatches(
    rendered.results.flatMap((result) =>
      parseMatchesFromText(result.text, result.dateText),
    ),
  );

  const grouped = splitMatchesByStatus(matches);

  return {
    source: 'sport1',
    status: 'ok',
    mode: 'playwright-render-multi-date',
    url: SPORT1_DARTS_URL,
    lastUpdated: new Date().toISOString(),
    total: matches.length,
    matchCount: matches.length,
    liveMatches: grouped.current.length,
    scheduledMatches: grouped.scheduled.length,
    finishedMatches: grouped.finished.length,
    hasLiveMatches: grouped.current.length > 0,
    availableDates: rendered.dateTabs,
    checkedDates: rendered.results.map((result) => ({
      dateText: result.dateText,
      clicked: result.clicked,
      textLength: result.text.length,
      hasNoEventsText: result.text.includes('An diesem Tag gibt es keine Events im Darts'),
    })),
    matches,
    current: grouped.current,
    scheduled: grouped.scheduled,
    finished: grouped.finished,
  };
}

async function getSport1DebugText() {
  const renderedText = await getRenderedSport1Text();
  const dateTabs = extractDateLabelsFromText(renderedText);

  return {
    source: 'sport1',
    url: SPORT1_DARTS_URL,
    lastUpdated: new Date().toISOString(),
    textLength: renderedText.length,
    availableDates: dateTabs,
    text: renderedText,
  };
}

module.exports = {
  getLiveDartsData,
  getSport1DebugText,
};
