const { buildSlovakDartsOpenSeedMatches } = require('./seed_slovak_darts_open');
const express = require('express');
const cors = require('cors');
const { getLiveDartsData } = require('./scraper');
const {
  archiveMatches,
  loadArchivedMatches,
  loadArchivedTournaments,
} = require('./supabase_archive');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
  res.json({
    name: 'DartCenter Live Scraper',
    status: 'online',
    endpoints: [
      '/live',
      '/live/current',
      '/live/scheduled',
      '/live/finished',
      '/archive',
      '/archive/tournaments',
      '/archive/seed/slovak-darts-open',
    ],
  });
});

app.get('/live', async (req, res) => {
  try {
    const data = await getLiveDartsData();

    await archiveMatches(data.matches);

    res.json(data);
  } catch (error) {
    res.status(500).json({
      lastUpdate: new Date().toISOString(),
      source: 'sport1',
      error: true,
      message: error.message,
      matches: [],
    });
  }
});

app.get('/live/current', async (req, res) => {
  try {
    const data = await getLiveDartsData();

    res.json({
      lastUpdate: data.lastUpdate,
      source: data.source,
      matchCount: data.matches.filter(
        (match) => match.status === 'live',
      ).length,
      matches: data.matches.filter(
        (match) => match.status === 'live',
      ),
    });
  } catch (error) {
    res.status(500).json({
      error: true,
      message: error.message,
    });
  }
});

app.get('/live/scheduled', async (req, res) => {
  try {
    const data = await getLiveDartsData();

    res.json({
      lastUpdate: data.lastUpdate,
      source: data.source,
      matchCount: data.matches.filter(
        (match) => match.status === 'scheduled',
      ).length,
      matches: data.matches.filter(
        (match) => match.status === 'scheduled',
      ),
    });
  } catch (error) {
    res.status(500).json({
      error: true,
      message: error.message,
    });
  }
});

app.get('/live/finished', async (req, res) => {
  try {
    const data = await getLiveDartsData();

    res.json({
      lastUpdate: data.lastUpdate,
      source: data.source,
      matchCount: data.matches.filter(
        (match) => match.status === 'finished',
      ).length,
      matches: data.matches.filter(
        (match) => match.status === 'finished',
      ),
    });
  } catch (error) {
    res.status(500).json({
      error: true,
      message: error.message,
    });
  }
});

app.get('/archive', async (req, res) => {
  try {
    const matches = await loadArchivedMatches(req.query.tournament);

    res.json({
      lastUpdate: new Date().toISOString(),
      source: 'supabase',
      matchCount: matches.length,
      matches,
    });
  } catch (error) {
    res.status(500).json({
      error: true,
      message: error.message,
    });
  }
});

app.get('/archive/tournaments', async (req, res) => {
  try {
    const tournaments = await loadArchivedTournaments();

    res.json({
      lastUpdate: new Date().toISOString(),
      source: 'supabase',
      count: tournaments.length,
      tournaments,
    });
  } catch (error) {
    res.status(500).json({
      error: true,
      message: error.message,
    });
  }
});

app.get('/archive/seed/slovak-darts-open', async (req, res) => {
  try {
    const matches = buildSlovakDartsOpenSeedMatches();

    await archiveMatches(matches);

    res.json({
      lastUpdate: new Date().toISOString(),
      source: 'manual-seed',
      tournament: 'Slovak Darts Open',
      matchCount: matches.length,
      matches,
    });
  } catch (error) {
    res.status(500).json({
      error: true,
      message: error.message,
    });
  }
});

app.listen(port, () => {
  console.log(
    `DartCenter Live Scraper läuft auf http://localhost:${port}`,
  );
});