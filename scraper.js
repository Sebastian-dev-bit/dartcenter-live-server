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

function formatPlayerName(value) {
  const text = normalizeText(value);

  if (!text.includes(',')) {
    return text;
  }

  const parts = text.split(',').map((part) => part.trim());

  if (parts.length < 2 || !parts[0] || !parts[1]) {
    return text;
  }

  return `${parts[1]} ${parts[0]}`;
}

async function openSport1Page(page) {
  await page.goto(SPORT1_DARTS_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });

  await page.waitForSelector('[data-testid="live-widget"]', {
    timeout: 30000,
  });

  await waitForLiveWidgetToFinishLoading(page);
}

async function waitForLiveWidgetToFinishLoading(page) {
  try {
    await page.waitForFunction(
      () => {
        const widget = document.querySelector('[data-testid="live-widget"]');

        if (!widget) {
          return false;
        }

        const text = widget.innerText || widget.textContent || '';

        const hasLoadingSpinner =
          widget.querySelector('[rotate="30"]') ||
          widget.querySelector('[rotate="60"]') ||
          widget.querySelector('[rotate="90"]') ||
          widget.querySelector('[rotate="120"]') ||
          widget.querySelector('[rotate="150"]') ||
          widget.querySelector('[rotate="180"]') ||
          widget.querySelector('[rotate="210"]') ||
          widget.querySelector('[rotate="240"]') ||
          widget.querySelector('[rotate="270"]') ||
          widget.querySelector('[rotate="300"]') ||
          widget.querySelector('[rotate="330"]') ||
          widget.querySelector('[rotate="360"]');

        const hasNoEventsText =
          text.includes('An diesem Tag gibt es keine Events im Darts') ||
          text.includes('keine Events');

        const hasCalendar =
          text.includes('Heute') ||
          /\b(Mo|Di|Mi|Do|Fr|Sa|So)\b/.test(text);

        const hasPossibleMatchContent =
          /\b\d{1,2}:\d{2}\b/.test(text) ||
          /\d+\s*:\s*\d+/.test(text) ||
          /\bvs\.?\b/i.test(text) ||
          /\bgegen\b/i.test(text) ||
          text.includes('Achtelfinale') ||
          text.includes('Viertelfinale') ||
          text.includes('Halbfinale') ||
          text.includes('Finale');

        if (hasLoadingSpinner && !hasNoEventsText && !hasPossibleMatchContent) {
          return false;
        }

        return hasCalendar || hasNoEventsText || hasPossibleMatchContent;
      },
      {
        timeout: 30000,
      },
    );
  } catch (_) {
    await page.waitForTimeout(5000);
  }

  await page.waitForTimeout(1500);
}

async function getVisibleBodyText(page) {
  return await page.evaluate(() => {
    return document.body
      ? document.body.innerText || document.body.textContent || ''
      : '';
  });
}

async function getLiveWidgetText(page) {
  return await page.evaluate(() => {
    const widget = document.querySelector('[data-testid="live-widget"]');

    if (!widget) {
      return document.body
        ? document.body.innerText || document.body.textContent || ''
        : '';
    }

    return widget.innerText || widget.textContent || '';
  });
}

async function getLiveWidgetHtml(page) {
  return await page.evaluate(() => {
    const widget = document.querySelector('[data-testid="live-widget"]');

    if (!widget) {
      return document.body ? document.body.innerHTML : '';
    }

    return widget.innerHTML || '';
  });
}

async function getLiveWidgetDebugState(page) {
  return await page.evaluate(() => {
    const widget = document.querySelector('[data-testid="live-widget"]');

    if (!widget) {
      return {
        hasWidget: false,
        textLength: 0,
        htmlLength: 0,
        hasSpinner: false,
        hasNoEventsText: false,
        hasCalendar: false,
        hasPossibleMatchContent: false,
      };
    }

    const text = widget.innerText || widget.textContent || '';
    const html = widget.innerHTML || '';

    const hasSpinner = Boolean(
      widget.querySelector('[rotate="30"]') ||
        widget.querySelector('[rotate="60"]') ||
        widget.querySelector('[rotate="90"]') ||
        widget.querySelector('[rotate="120"]') ||
        widget.querySelector('[rotate="150"]') ||
        widget.querySelector('[rotate="180"]') ||
        widget.querySelector('[rotate="210"]') ||
        widget.querySelector('[rotate="240"]') ||
        widget.querySelector('[rotate="270"]') ||
        widget.querySelector('[rotate="300"]') ||
        widget.querySelector('[rotate="330"]') ||
        widget.querySelector('[rotate="360"]'),
    );

    return {
      hasWidget: true,
      textLength: text.length,
      htmlLength: html.length,
      hasSpinner,
      hasNoEventsText:
        text.includes('An diesem Tag gibt es keine Events im Darts') ||
        text.includes('keine Events'),
      hasCalendar:
        text.includes('Heute') || /\b(Mo|Di|Mi|Do|Fr|Sa|So)\b/.test(text),
      hasPossibleMatchContent:
        /\b\d{1,2}:\d{2}\b/.test(text) ||
        /\d+\s*:\s*\d+/.test(text) ||
        /\bvs\.?\b/i.test(text) ||
        /\bgegen\b/i.test(text) ||
        text.includes('Achtelfinale') ||
        text.includes('Viertelfinale') ||
        text.includes('Halbfinale') ||
        text.includes('Finale'),
    };
  });
}

function extractDateLabelsFromText(text) {
  const value = normalizeText(text);
  const labels = [];
  const regex =
    /\b(Mo|Di|Mi|Do|Fr|Sa|So)\s+\d{1,2}\b|\bHeute\b|\bMorgen\b|\bGestern\b/g;

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
    const clicked = await page.evaluate((label) => {
      const normalizedLabel = label.trim();

      const widget = document.querySelector('[data-testid="live-widget"]');
      const root = widget || document.body;

      if (!root) {
        return false;
      }

      const parts = normalizedLabel.split(/\s+/);
      const dayName = parts[0] || normalizedLabel;
      const dayNumber = parts[1] || null;

      const calendarItems = Array.from(root.querySelectorAll('div')).filter(
        (element) => {
          const text = (element.innerText || element.textContent || '')
            .replace(/\s+/g, ' ')
            .trim();

          if (!text) {
            return false;
          }

          if (normalizedLabel === 'Heute') {
            return text === 'Heute' || /^Heute\s+\d{1,2}$/.test(text);
          }

          if (!dayNumber) {
            return text === normalizedLabel;
          }

          return (
            text === normalizedLabel ||
            text === `${dayName} ${dayNumber}` ||
            (text.includes(dayName) && text.includes(dayNumber))
          );
        },
      );

      for (const element of calendarItems) {
        const rect = element.getBoundingClientRect();

        if (rect.width <= 0 || rect.height <= 0) {
          continue;
        }

        const clickable = element.closest('div') || element;

        clickable.dispatchEvent(
          new PointerEvent('pointerdown', {
            bubbles: true,
            cancelable: true,
            view: window,
          }),
        );

        clickable.dispatchEvent(
          new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
            view: window,
          }),
        );

        clickable.dispatchEvent(
          new PointerEvent('pointerup', {
            bubbles: true,
            cancelable: true,
            view: window,
          }),
        );

        clickable.dispatchEvent(
          new MouseEvent('mouseup', {
            bubbles: true,
            cancelable: true,
            view: window,
          }),
        );

        clickable.dispatchEvent(
          new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            view: window,
          }),
        );

        return true;
      }

      return false;
    }, dateLabel);

    if (!clicked) {
      return false;
    }

    await waitForLiveWidgetToFinishLoading(page);
    await page.waitForTimeout(1000);

    return true;
  } catch (_) {
    return false;
  }
}

function parseScoreText(value) {
  const text = normalizeText(value);
  const match = text.match(/(\d+)\s*:\s*(\d+)/);

  if (!match) {
    return {
      scoreText: '',
      homeScore: null,
      awayScore: null,
      hasScore: false,
    };
  }

  return {
    scoreText: `${Number(match[1])}:${Number(match[2])}`,
    homeScore: Number(match[1]),
    awayScore: Number(match[2]),
    hasScore: true,
  };
}

function determineStatusFromScore(score) {
  if (!score.hasScore) {
    return 'scheduled';
  }

  return 'finished';
}

function determineWinner(homeName, awayName, status, score) {
  if (status !== 'finished' || !score.hasScore) {
    return null;
  }

  if (score.homeScore > score.awayScore) {
    return homeName;
  }

  if (score.awayScore > score.homeScore) {
    return awayName;
  }

  return null;
}

function buildDomMatchId(match) {
  return [
    match.sportRadarId,
    match.dateText,
    match.tournament,
    match.round,
    match.homeName,
    match.awayName,
    match.scoreText,
  ]
    .map(normalizeKey)
    .filter(Boolean)
    .join('_');
}

function parseSportRadarIdFromHref(href) {
  const value = String(href || '');
  const match = value.match(/sr:sport_event:\d+/);

  return match ? match[0] : '';
}

async function parseMatchesFromDom(page, dateText = '') {
  return await page.evaluate(
    ({ dateTextValue }) => {
      const normalize = (value) =>
        String(value || '')
          .replace(/\u00a0/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

      const formatName = (value) => {
        const text = normalize(value);

        if (!text.includes(',')) {
          return text;
        }

        const parts = text.split(',').map((part) => part.trim());

        if (parts.length < 2 || !parts[0] || !parts[1]) {
          return text;
        }

        return `${parts[1]} ${parts[0]}`;
      };

      const parseScore = (value) => {
        const text = normalize(value);
        const match = text.match(/(\d+)\s*:\s*(\d+)/);

        if (!match) {
          return {
            scoreText: '',
            homeScore: null,
            awayScore: null,
            hasScore: false,
          };
        }

        return {
          scoreText: `${Number(match[1])}:${Number(match[2])}`,
          homeScore: Number(match[1]),
          awayScore: Number(match[2]),
          hasScore: true,
        };
      };

      const normalizeKey = (value) =>
        normalize(value)
          .toLowerCase()
          .replace(/[^a-z0-9äöüß]+/gi, '-')
          .replace(/^-+|-+$/g, '');

      const parseSportRadarId = (href) => {
        const match = String(href || '').match(/sr:sport_event:\d+/);
        return match ? match[0] : '';
      };

      const widget = document.querySelector('[data-testid="live-widget"]');

      if (!widget) {
        return [];
      }

      const textOf = (element) =>
        normalize(element ? element.innerText || element.textContent || '' : '');

      const tournamentCandidates = Array.from(widget.querySelectorAll('*')).filter(
        (element) => {
          const text = textOf(element);

          if (!text) {
            return false;
          }

          if (
            text.includes('DARTS HEUTE LIVE') ||
            text.includes('Spielplan') ||
            text.includes('Heute')
          ) {
            return false;
          }

          return (
            text.includes('Darts Masters') ||
            text.includes('Darts Open') ||
            text.includes('Players Championship') ||
            text.includes('World Matchplay') ||
            text.includes('World Championship') ||
            text.includes('Premier League') ||
            text.includes('Grand Prix') ||
            text.includes('Grand Slam')
          );
        },
      );

      let tournament = 'PDC Darts';

      for (const candidate of tournamentCandidates) {
        const text = textOf(candidate);

        if (text.length > 3 && text.length < 80) {
          tournament = text;
          break;
        }
      }

      const roundCandidates = Array.from(widget.querySelectorAll('*')).filter(
        (element) => {
          const text = textOf(element).toLowerCase();

          if (!text || text.length > 50) {
            return false;
          }

          return (
            text.includes('runde') ||
            text.includes('sechzehntelfinale') ||
            text.includes('achtelfinale') ||
            text.includes('viertelfinale') ||
            text.includes('halbfinale') ||
            text === 'finale' ||
            text.includes('finale')
          );
        },
      );

      let round = 'Spiel';

      for (const candidate of roundCandidates) {
        const text = textOf(candidate);

        if (text && text.length < 50) {
          round = text;
          break;
        }
      }

      const matchLinks = Array.from(
        widget.querySelectorAll('a[href*="sr:sport_event:"]'),
      );

      const uniqueLinks = [];
      const seenIds = new Set();

      for (const link of matchLinks) {
        const href = link.getAttribute('href') || '';
        const sportRadarId = parseSportRadarId(href);

        if (!sportRadarId || seenIds.has(sportRadarId)) {
          continue;
        }

        const linkText = textOf(link);

        if (!/\d+\s*:\s*\d+/.test(linkText) && !/\d{1,2}:\d{2}/.test(linkText)) {
          continue;
        }

        seenIds.add(sportRadarId);
        uniqueLinks.push(link);
      }

      const matches = [];

      for (const link of uniqueLinks) {
        const href = link.getAttribute('href') || '';
        const sportRadarId = parseSportRadarId(href);

        const spans = Array.from(link.querySelectorAll('span'))
          .map((span) => textOf(span))
          .filter(Boolean);

        const scoreIndex = spans.findIndex((value) =>
          /\d+\s*:\s*\d+/.test(value),
        );

        const timeIndex = spans.findIndex((value) =>
          /^\d{1,2}:\d{2}$/.test(value),
        );

        let homeRaw = '';
        let awayRaw = '';
        let scoreRaw = '';
        let timeText = '';

        if (scoreIndex >= 0) {
          scoreRaw = spans[scoreIndex];

          for (let index = scoreIndex - 1; index >= 0; index -= 1) {
            if (!/\d+\s*:\s*\d+/.test(spans[index])) {
              homeRaw = spans[index];
              break;
            }
          }

          for (let index = scoreIndex + 1; index < spans.length; index += 1) {
            if (!/\d+\s*:\s*\d+/.test(spans[index])) {
              awayRaw = spans[index];
              break;
            }
          }
        } else if (timeIndex >= 0) {
          timeText = spans[timeIndex];

          for (let index = timeIndex - 1; index >= 0; index -= 1) {
            if (!/^\d{1,2}:\d{2}$/.test(spans[index])) {
              homeRaw = spans[index];
              break;
            }
          }

          for (let index = timeIndex + 1; index < spans.length; index += 1) {
            if (!/^\d{1,2}:\d{2}$/.test(spans[index])) {
              awayRaw = spans[index];
              break;
            }
          }
        }

        if (!homeRaw || !awayRaw) {
          continue;
        }

        const score = parseScore(scoreRaw);
        const status = score.hasScore ? 'finished' : 'scheduled';
        const homeName = formatName(homeRaw);
        const awayName = formatName(awayRaw);

        const winner =
          status === 'finished' && score.hasScore
            ? score.homeScore > score.awayScore
              ? homeName
              : score.awayScore > score.homeScore
                ? awayName
                : null
            : null;

        const match = {
          id: '',
          source: 'sport1',
          sportRadarId,
          href,
          tournament,
          tournamentName: tournament,
          round,
          roundName: round,
          status,

          dateText: dateTextValue,
          timeText,

          homeName,
          awayName,
          player1: homeRaw,
          player2: awayRaw,
          player1DisplayName: homeName,
          player2DisplayName: awayName,

          homeScore: score.hasScore ? score.homeScore : null,
          awayScore: score.hasScore ? score.awayScore : null,
          legs1: score.hasScore ? score.homeScore : null,
          legs2: score.hasScore ? score.awayScore : null,
          legs: score.hasScore ? `${score.homeScore}-${score.awayScore}` : '0-0',
          scoreText: score.scoreText,
          hasScore: score.hasScore,

          isLive: status === 'live',
          isScheduled: status === 'scheduled',
          isFinished: status === 'finished',

          winner,
          winnerDisplayName: winner,

          rawText: textOf(link),
          updatedAt: new Date().toISOString(),
        };

        match.id = [
          match.sportRadarId,
          match.dateText,
          match.tournament,
          match.round,
          match.homeName,
          match.awayName,
          match.scoreText,
        ]
          .map(normalizeKey)
          .filter(Boolean)
          .join('_');

        matches.push(match);
      }

      return matches;
    },
    {
      dateTextValue: dateText,
    },
  );
}

function removeDuplicateMatches(matches) {
  const seen = new Set();
  const result = [];

  for (const match of matches) {
    const key = [
      match.sportRadarId,
      match.dateText,
      match.tournament,
      match.round,
      match.homeName,
      match.awayName,
      match.scoreText,
      match.timeText,
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

    const text = await getLiveWidgetText(page);

    return normalizeText(text).replace(/\s{2,}/g, '\n');
  } finally {
    await browser.close();
  }
}

async function getRenderedSport1DataByDate() {
  const { browser, page } = await createRenderedPage();

  try {
    await openSport1Page(page);

    const firstText = await getLiveWidgetText(page);
    const dateTabs = extractDateLabelsFromText(firstText);

    const results = [
      {
        dateText: dateTabs.includes('Heute') ? 'Heute' : dateTabs[0] || '',
        clicked: false,
        text: firstText,
        matches: await parseMatchesFromDom(
          page,
          dateTabs.includes('Heute') ? 'Heute' : dateTabs[0] || '',
        ),
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

      const text = await getLiveWidgetText(page);
      const matches = await parseMatchesFromDom(page, dateLabel);

      results.push({
        dateText: dateLabel,
        clicked: true,
        text,
        matches,
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
  const rendered = await getRenderedSport1DataByDate();

  const matches = removeDuplicateMatches(
    rendered.results.flatMap((result) => result.matches),
  );

  const grouped = splitMatchesByStatus(matches);

  return {
    source: 'sport1',
    status: 'ok',
    mode: 'playwright-render-dom-parser',
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
      matchCount: result.matches.length,
      hasNoEventsText: result.text.includes(
        'An diesem Tag gibt es keine Events im Darts',
      ),
    })),

    matches,
    current: grouped.current,
    scheduled: grouped.scheduled,
    finished: grouped.finished,
  };
}

async function getSport1DebugText() {
  const { browser, page } = await createRenderedPage();

  try {
    await openSport1Page(page);

    const widgetText = await getLiveWidgetText(page);
    const bodyText = await getVisibleBodyText(page);
    const dateTabs = extractDateLabelsFromText(widgetText || bodyText);
    const widgetState = await getLiveWidgetDebugState(page);
    const matches = await parseMatchesFromDom(
      page,
      dateTabs.includes('Heute') ? 'Heute' : dateTabs[0] || '',
    );

    return {
      source: 'sport1',
      url: SPORT1_DARTS_URL,
      lastUpdated: new Date().toISOString(),
      widgetState,
      textLength: widgetText.length,
      bodyTextLength: bodyText.length,
      availableDates: dateTabs,
      parsedMatchCount: matches.length,
      parsedMatches: matches,
      text: normalizeText(widgetText).replace(/\s{2,}/g, '\n'),
    };
  } finally {
    await browser.close();
  }
}

async function getSport1DebugHtml() {
  const { browser, page } = await createRenderedPage();

  try {
    await openSport1Page(page);

    const html = await getLiveWidgetHtml(page);
    const widgetState = await getLiveWidgetDebugState(page);

    return {
      source: 'sport1',
      url: SPORT1_DARTS_URL,
      lastUpdated: new Date().toISOString(),
      widgetState,
      htmlLength: html.length,
      html,
    };
  } finally {
    await browser.close();
  }
}

module.exports = {
  getLiveDartsData,
  getSport1DebugText,
  getSport1DebugHtml,
};
