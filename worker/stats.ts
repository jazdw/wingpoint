import { Hono } from 'hono';
import { computeGame, getProfile, PROFILES } from '../shared/scoring';
import type { GameSummary, RivalStat, ScoreMap, Stats } from '../shared/types';
import { requireAuth } from './auth';
import type { AppEnv } from './env';
import { type GameRow, type PlayerRow, serializeSummary } from './games';

interface Entry {
  total: number;
  points: Record<string, number>;
  won: boolean;
  playerCount: number;
  profileId: string;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number, places = 1): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function groupPlayers(rows: PlayerRow[]): Map<string, PlayerRow[]> {
  const map = new Map<string, PlayerRow[]>();
  for (const row of rows) {
    const list = map.get(row.game_id) ?? [];
    list.push(row);
    map.set(row.game_id, list);
  }
  for (const list of map.values()) list.sort((a, b) => a.seat - b.seat);
  return map;
}

function parseScores(value: string): ScoreMap {
  try {
    return JSON.parse(value) as ScoreMap;
  } catch {
    return {};
  }
}

export const statsRoutes = new Hono<AppEnv>();

statsRoutes.use('*', requireAuth);

statsRoutes.get('/', async (c) => {
  const scope = c.req.query('scope') === 'group' ? 'group' : 'me';
  const user = c.get('user');

  const allGames = await c.env.DB.prepare(
    'SELECT * FROM games ORDER BY played_at DESC, created_at DESC',
  ).all<GameRow>();
  const allPlayers = await c.env.DB.prepare('SELECT * FROM game_players').all<PlayerRow>();
  const playersByGame = groupPlayers(allPlayers.results);

  const completed = allGames.results.filter((game) => game.status === 'completed');

  const entries: Entry[] = [];
  const categorySums = new Map<string, { sum: number; count: number; label: string }>();
  const rivals = new Map<string, RivalStat>();
  let gamesWithMe = 0;

  const categoryLabel = new Map<string, string>();
  for (const profile of PROFILES) {
    for (const category of profile.categories) categoryLabel.set(category.id, category.label);
  }

  for (const game of completed) {
    const players = playersByGame.get(game.id) ?? [];
    const computed = computeGame(
      game.scoring_profile,
      players.map((player) => ({ scores: parseScores(player.scores) })),
    );
    const winnerIds = new Set(computed.winners.map((index) => players[index]?.id));

    const myIndex = scope === 'me' ? players.findIndex((player) => player.user_id === user.id) : -1;
    if (scope === 'me' && myIndex === -1) continue;
    if (scope === 'me') gamesWithMe += 1;

    const indices = scope === 'me' ? [myIndex] : players.map((_, index) => index);
    for (const index of indices) {
      const player = players[index];
      if (!player) continue;
      const points = computed.perPlayer[index] ?? {};
      const total = computed.totals[index] ?? 0;
      entries.push({
        total,
        points,
        won: winnerIds.has(player.id) && game.mode === 'competitive',
        playerCount: players.length,
        profileId: game.scoring_profile,
      });
      for (const [categoryId, value] of Object.entries(points)) {
        const current = categorySums.get(categoryId) ?? {
          sum: 0,
          count: 0,
          label: categoryLabel.get(categoryId) ?? categoryId,
        };
        current.sum += value;
        current.count += 1;
        categorySums.set(categoryId, current);
      }
    }

    if (scope === 'me' && myIndex !== -1) {
      const myTotal = computed.totals[myIndex] ?? 0;
      players.forEach((player, index) => {
        if (index === myIndex) return;
        const key = player.user_id ?? `name:${player.name.toLowerCase()}`;
        const rival = rivals.get(key) ?? {
          name: player.name,
          userId: player.user_id,
          gamesTogether: 0,
          myWins: 0,
          theirWins: 0,
          myAverage: 0,
          theirAverage: 0,
        };
        rival.gamesTogether += 1;
        rival.myAverage += myTotal;
        rival.theirAverage += computed.totals[index] ?? 0;
        if (winnerIds.has(players[myIndex].id) && game.mode === 'competitive') rival.myWins += 1;
        if (winnerIds.has(player.id) && game.mode === 'competitive') rival.theirWins += 1;
        rivals.set(key, rival);
      });
    }
  }

  const totals = entries.map((entry) => entry.total);
  const wins = entries.filter((entry) => entry.won).length;

  const byPlayerCountMap = new Map<number, { games: number; total: number }>();
  const byProfileMap = new Map<string, { games: number; total: number }>();
  for (const entry of entries) {
    const countBucket = byPlayerCountMap.get(entry.playerCount) ?? { games: 0, total: 0 };
    countBucket.games += 1;
    countBucket.total += entry.total;
    byPlayerCountMap.set(entry.playerCount, countBucket);

    const profileBucket = byProfileMap.get(entry.profileId) ?? { games: 0, total: 0 };
    profileBucket.games += 1;
    profileBucket.total += entry.total;
    byProfileMap.set(entry.profileId, profileBucket);
  }

  const recent: GameSummary[] = allGames.results
    .slice(0, 10)
    .map((game) => serializeSummary(game, playersByGame.get(game.id) ?? []));

  const result: Stats = {
    scope,
    totals: {
      games: allGames.results.length,
      completed: completed.length,
      wins,
      winRate: scope === 'me' ? (gamesWithMe ? wins / gamesWithMe : 0) : entries.length ? wins / entries.length : 0,
      averageScore: round(average(totals)),
      bestScore: totals.length ? Math.max(...totals) : 0,
    },
    categoryAverages: [...categorySums.entries()]
      .map(([id, value]) => ({ id, label: value.label, average: round(value.sum / value.count) }))
      .sort((a, b) => b.average - a.average),
    byPlayerCount: [...byPlayerCountMap.entries()]
      .map(([playerCount, value]) => ({
        playerCount,
        games: value.games,
        averageScore: round(value.total / value.games),
      }))
      .sort((a, b) => a.playerCount - b.playerCount),
    byProfile: [...byProfileMap.entries()]
      .map(([profile, value]) => ({
        profile,
        name: getProfile(profile).name,
        games: value.games,
        averageScore: round(value.total / value.games),
      }))
      .sort((a, b) => b.games - a.games),
    rivals: [...rivals.values()]
      .map((rival) => ({
        ...rival,
        myAverage: round(rival.myAverage / rival.gamesTogether),
        theirAverage: round(rival.theirAverage / rival.gamesTogether),
      }))
      .sort((a, b) => b.gamesTogether - a.gamesTogether)
      .slice(0, 20),
    recent,
  };

  return c.json({ stats: result });
});
