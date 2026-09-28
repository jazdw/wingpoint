import { Hono } from 'hono';
import { computeGame } from '../shared/scoring';
import type { GoalBoard, RivalStat, ScoreMap, Stats } from '../shared/types';
import { requireAuth } from './auth';
import type { AppEnv, Env } from './env';
import { configForGame, type GameRow, type PlayerRow, profileForGame, serializeSummary } from './games';

export interface StatsFilters {
  expansions: string[];
  goalBoard: GoalBoard | null;
}

interface Entry {
  total: number;
  points: Record<string, number>;
  won: boolean;
  playerCount: number;
  profileId: string;
}

export function parseStatsFilters(
  expansionsParam: string | undefined,
  boardParam: string | undefined,
): StatsFilters {
  return {
    expansions: expansionsParam
      ? expansionsParam.split(',').map((value) => value.trim()).filter(Boolean)
      : [],
    goalBoard: boardParam === 'green' || boardParam === 'blue' ? boardParam : null,
  };
}

function matchesFilters(game: GameRow, filters: StatsFilters): boolean {
  const config = configForGame(game);
  if (filters.goalBoard && config.goalBoard !== filters.goalBoard) return false;
  if (filters.expansions.length && !filters.expansions.every((id) => config.expansions.includes(id))) {
    return false;
  }
  return true;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number, places = 1): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function parseScores(value: string): ScoreMap {
  try {
    return JSON.parse(value) as ScoreMap;
  } catch {
    return {};
  }
}

async function havePlayedTogether(env: Env, a: string, b: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 FROM game_players x
       JOIN game_players y ON y.game_id = x.game_id
      WHERE x.user_id = ? AND y.user_id = ?
        AND x.status = 'accepted' AND y.status = 'accepted'
      LIMIT 1`,
  )
    .bind(a, b)
    .first();
  return Boolean(row);
}

/** All completed games the given user took part in, with their players. */
async function loadParticipatedGames(
  env: Env,
  userId: string,
): Promise<{ games: GameRow[]; playersByGame: Map<string, PlayerRow[]> }> {
  const games = await env.DB.prepare(
    `SELECT DISTINCT g.* FROM games g
       JOIN game_players gp ON gp.game_id = g.id
      WHERE gp.user_id = ? AND gp.status = 'accepted' AND g.status = 'completed'
      ORDER BY g.played_at DESC, g.created_at DESC`,
  )
    .bind(userId)
    .all<GameRow>();

  const playersByGame = new Map<string, PlayerRow[]>();
  if (games.results.length > 0) {
    const placeholders = games.results.map(() => '?').join(', ');
    const players = await env.DB.prepare(
      `SELECT * FROM game_players WHERE game_id IN (${placeholders}) ORDER BY seat ASC`,
    )
      .bind(...games.results.map((game) => game.id))
      .all<PlayerRow>();
    for (const player of players.results) {
      const list = playersByGame.get(player.game_id) ?? [];
      list.push(player);
      playersByGame.set(player.game_id, list);
    }
  }
  return { games: games.results, playersByGame };
}

async function computeStatsForUser(
  env: Env,
  userId: string,
  filters: StatsFilters,
): Promise<Stats> {
  const subjectRow = await env.DB.prepare('SELECT id, name, picture FROM users WHERE id = ?')
    .bind(userId)
    .first<{ id: string; name: string; picture: string | null }>();

  const loaded = await loadParticipatedGames(env, userId);
  const games = loaded.games.filter((game) => matchesFilters(game, filters));
  const playersByGame = loaded.playersByGame;

  const entries: Entry[] = [];
  const categorySums = new Map<string, { sum: number; count: number; label: string }>();
  const profileNames = new Map<string, string>();
  const rivals = new Map<string, RivalStat>();

  for (const game of games) {
    const players = playersByGame.get(game.id) ?? [];
    const profile = profileForGame(game);
    profileNames.set(profile.id, profile.name);
    const computed = computeGame(
      profile,
      players.map((player) => ({ scores: parseScores(player.scores) })),
    );
    const winnerIds = new Set(computed.winners.map((index) => players[index]?.id));

    const myIndex = players.findIndex((player) => player.user_id === userId);
    if (myIndex === -1) continue;

    const points = computed.perPlayer[myIndex] ?? {};
    const myTotal = computed.totals[myIndex] ?? 0;
    const won = winnerIds.has(players[myIndex].id);
    entries.push({
      total: myTotal,
      points,
      won,
      playerCount: players.length,
      profileId: profile.id,
    });

    for (const [categoryId, value] of Object.entries(points)) {
      const label = profile.categories.find((category) => category.id === categoryId)?.label ?? categoryId;
      const current = categorySums.get(categoryId) ?? { sum: 0, count: 0, label };
      current.sum += value;
      current.count += 1;
      categorySums.set(categoryId, current);
    }

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
      if (won) rival.myWins += 1;
      if (winnerIds.has(player.id)) rival.theirWins += 1;
      rivals.set(key, rival);
    });
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

  return {
    subject: subjectRow ?? null,
    totals: {
      games: games.length,
      completed: games.length,
      wins,
      winRate: games.length ? wins / games.length : 0,
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
        name: profileNames.get(profile) ?? profile,
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
      .slice(0, 30),
    recent: games
      .slice(0, 10)
      .map((game) => serializeSummary(game, playersByGame.get(game.id) ?? [])),
  };
}

export const statsRoutes = new Hono<AppEnv>();

statsRoutes.use('*', requireAuth);

/** Linked accounts you have played a game with (for viewing their stats). */
statsRoutes.get('/players', async (c) => {
  const viewer = c.get('user');
  const { games, playersByGame } = await loadParticipatedGames(c.env, viewer.id);

  const people = new Map<string, { id: string; name: string; picture: string | null; games: number }>();
  for (const game of games) {
    for (const player of playersByGame.get(game.id) ?? []) {
      if (player.user_id && player.user_id !== viewer.id) {
        const current = people.get(player.user_id) ?? {
          id: player.user_id,
          name: player.name,
          picture: null,
          games: 0,
        };
        current.games += 1;
        people.set(player.user_id, current);
      }
    }
  }

  if (people.size > 0) {
    const placeholders = [...people.keys()].map(() => '?').join(', ');
    const rows = await c.env.DB.prepare(
      `SELECT id, name, picture FROM users WHERE id IN (${placeholders})`,
    )
      .bind(...people.keys())
      .all<{ id: string; name: string; picture: string | null }>();
    for (const row of rows.results) {
      const person = people.get(row.id);
      if (person) {
        person.name = row.name;
        person.picture = row.picture;
      }
    }
  }

  return c.json({
    players: [...people.values()].sort((a, b) => b.games - a.games || a.name.localeCompare(b.name)),
  });
});

statsRoutes.get('/', async (c) => {
  const viewer = c.get('user');
  const requested = c.req.query('userId');
  const subjectId = requested && requested.length > 0 ? requested : viewer.id;

  if (subjectId !== viewer.id && !(await havePlayedTogether(c.env, viewer.id, subjectId))) {
    return c.json(
      { error: 'You can only view stats for players you have played a game with.' },
      403,
    );
  }

  const filters = parseStatsFilters(c.req.query('expansions'), c.req.query('goalBoard'));
  const stats = await computeStatsForUser(c.env, subjectId, filters);
  return c.json({ stats });
});
