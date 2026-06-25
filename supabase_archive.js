require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase =
  supabaseUrl && supabaseServiceKey
    ? createClient(supabaseUrl, supabaseServiceKey)
    : null;

async function archiveMatches(matches) {
  if (!supabase || !Array.isArray(matches) || matches.length === 0) {
    return;
  }

  const rows = matches.map((match) => ({
    match_id: match.id,
    tournament: match.tournament,
    tournament_name: match.tournamentName ?? match.tournament,
    tournament_rule_name: match.tournamentRuleName ?? null,
    has_tournament_rule: match.hasTournamentRule ?? false,
    round: match.round,
    round_name: match.roundName ?? match.round,
    round_order: match.roundOrder ?? 999,
    date_label: match.dateLabel ?? null,
    date_index: match.dateIndex ?? 0,
    match_order: match.matchOrder ?? 0,
    bracket_position: match.bracketPosition ?? 0,
    player1: match.player1,
    player2: match.player2,
    home_name: match.homeName,
    away_name: match.awayName,
    player1_display_name: match.player1DisplayName,
    player2_display_name: match.player2DisplayName,
    start_time: match.startTime ?? null,
    legs: match.legs,
    legs1: match.legs1,
    legs2: match.legs2,
    home_score: match.homeScore ?? null,
    away_score: match.awayScore ?? null,
    target_legs: match.targetLegs ?? null,
    best_of_legs: match.bestOfLegs ?? null,
    score_text: match.scoreText,
    status: match.status,
    winner: match.winner ?? null,
    winner_display_name: match.winnerDisplayName ?? null,
    global_order: match.globalOrder ?? 0,
    raw_json: match,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from('dart_matches')
    .upsert(rows, { onConflict: 'match_id' });

  if (error) {
    console.error('Supabase Archiv Fehler:', error.message);
  }
}

async function loadArchivedMatches(tournament) {
  if (!supabase) {
    return [];
  }

  let query = supabase
    .from('dart_matches')
    .select('*')
    .order('round_order', { ascending: true })
    .order('match_order', { ascending: true });

  if (tournament) {
    query = query.ilike('tournament', `%${tournament}%`);
  }

  const { data, error } = await query;

  if (error) {
    throw error;
  }

  return data ?? [];
}

async function loadArchivedTournaments() {
  if (!supabase) {
    return [];
  }

  const { data, error } = await supabase
    .from('dart_matches')
    .select('tournament, tournament_name, updated_at')
    .order('updated_at', { ascending: false });

  if (error) {
    throw error;
  }

  const seen = new Set();
  const tournaments = [];

  for (const row of data ?? []) {
    const key = row.tournament_name || row.tournament;

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);

    tournaments.push({
      tournament: row.tournament,
      tournamentName: row.tournament_name,
      updatedAt: row.updated_at,
    });
  }

  return tournaments;
}

module.exports = {
  archiveMatches,
  loadArchivedMatches,
  loadArchivedTournaments,
};