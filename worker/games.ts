import { Hono } from 'hono';
import {
  computeGame,
  deriveProfile,
  GOAL_ROUNDS,
  goalRoundKey,
  nectarKey,
  normalizeConfig,
  TIEBREAK_KEY,
  validateConfig,
  type ScoringProfile,
} from '../shared/scoring';
import type {
  CoreSet,
  Game,
  GameConfig,
  GamePlayer,
  GameStatus,
  GameSummary,
  GoalBoard,
  PlayerStatus,
  ScoreMap,
} from '../shared/types';
import { requireAuth } from './auth';
import type { AppEnv, Env } from './env';

/* ------------------------------------------------------------------ */
/* Row types & serialization                                           */
/* ------------------------------------------------------------------ */

export interface GameRow {
  id: string;
  owner_id: string;
  played_at: number;
  status: GameStatus;
  core_sets: string;
  expansions: string;
  goal_board: string;
  notes: string | null;
  created_at: number;
  updated_at: number;
}

export interface PlayerRow {
  id: string;
  game_id: string;
  user_id: string | null;
  name: string;
  seat: number;
  status: PlayerStatus;
  scores: string;
  points: string;
  total: number;
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function configForGame(
  row: Pick<GameRow, 'core_sets' | 'expansions' | 'goal_board'>,
): GameConfig {
  return normalizeConfig({
    coreSets: parseJson<CoreSet[]>(row.core_sets, ['wingspan']),
    expansions: parseJson<string[]>(row.expansions, []),
    goalBoard: row.goal_board === 'blue' ? 'blue' : 'green',
  });
}

export function profileForGame(row: GameRow): ScoringProfile {
  return deriveProfile(configForGame(row));
}

function serializePlayer(row: PlayerRow): GamePlayer {
  return {
    id: row.id,
    name: row.name,
    userId: row.user_id,
    seat: row.seat,
    status: row.status === 'pending' ? 'pending' : 'accepted',
    scores: parseJson<ScoreMap>(row.scores, {}),
  };
}

function serializeGame(row: GameRow, players: PlayerRow[]): Game {
  const config = configForGame(row);
  return {
    id: row.id,
    ownerId: row.owner_id,
    playedAt: row.played_at,
    status: row.status,
    coreSets: config.coreSets,
    expansions: config.expansions,
    goalBoard: config.goalBoard,
    notes: row.notes,
    players: players.map(serializePlayer),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function serializeSummary(row: GameRow, players: PlayerRow[]): GameSummary {
  const ordered = [...players].sort((a, b) => a.seat - b.seat);
  const config = configForGame(row);
  const profile = deriveProfile(config);
  const computed = computeGame(
    profile,
    ordered.map((player) => ({ scores: parseJson<ScoreMap>(player.scores, {}) })),
  );
  const winners = computed.winners.map((index) => ordered[index]?.id).filter(Boolean) as string[];
  return {
    id: row.id,
    ownerId: row.owner_id,
    playedAt: row.played_at,
    status: row.status,
    coreSets: config.coreSets,
    expansions: config.expansions,
    goalBoard: config.goalBoard,
    scored: computed.totals.some((total) => total > 0),
    players: ordered.map((player, index) => ({
      id: player.id,
      name: player.name,
      userId: player.user_id,
      status: player.status === 'pending' ? 'pending' : 'accepted',
      total: computed.totals[index] ?? 0,
    })),
    winners,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

export async function loadGameRow(env: Env, id: string): Promise<GameRow | null> {
  return env.DB.prepare('SELECT * FROM games WHERE id = ?').bind(id).first<GameRow>();
}

async function loadPlayerRows(env: Env, gameId: string): Promise<PlayerRow[]> {
  const result = await env.DB.prepare(
    'SELECT * FROM game_players WHERE game_id = ? ORDER BY seat ASC',
  )
    .bind(gameId)
    .all<PlayerRow>();
  return result.results;
}

export async function loadGame(env: Env, id: string): Promise<Game | null> {
  const row = await loadGameRow(env, id);
  if (!row) return null;
  const players = await loadPlayerRows(env, id);
  return serializeGame(row, players);
}

/** Games visible to a user: ones they own or are a linked player in. */
export const VISIBLE_GAMES_SQL = `SELECT DISTINCT g.*
   FROM games g
   LEFT JOIN game_players gp ON gp.game_id = g.id AND gp.user_id = ?
  WHERE g.owner_id = ? OR gp.user_id IS NOT NULL`;

export async function canViewGame(env: Env, game: GameRow, userId: string): Promise<boolean> {
  if (game.owner_id === userId) return true;
  const player = await env.DB.prepare(
    'SELECT 1 FROM game_players WHERE game_id = ? AND user_id = ?',
  )
    .bind(game.id, userId)
    .first();
  return Boolean(player);
}

/* ------------------------------------------------------------------ */
/* Validation & writes                                                 */
/* ------------------------------------------------------------------ */

const STATUSES: GameStatus[] = ['in_progress', 'completed', 'cancelled'];

interface PlayerInput {
  id?: string;
  name: string;
  userId?: string | null;
  scores?: ScoreMap;
}

function sanitizeScores(profile: ScoringProfile, scores: ScoreMap | undefined): ScoreMap {
  const clean: ScoreMap = {};

  const put = (key: string, raw: number | null | undefined, signed = false, max?: number) => {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      clean[key] = null;
      return;
    }
    let value = Math.round(raw);
    if (!signed) {
      value = Math.max(0, value);
      if (max !== undefined) value = Math.min(max, value);
    }
    clean[key] = value;
  };

  for (const category of profile.categories) {
    if (category.kind === 'nectar' && category.habitats) {
      for (const habitat of category.habitats) {
        const key = nectarKey(habitat.id);
        put(key, scores?.[key]);
      }
    } else if (category.kind === 'roundGoals') {
      for (let round = 1; round <= GOAL_ROUNDS; round += 1) {
        const key = goalRoundKey(round);
        put(key, scores?.[key], false, profile.goalBoard === 'green' ? 3 : undefined);
      }
    } else {
      put(category.id, scores?.[category.id], category.kind === 'signed');
    }
  }

  put(TIEBREAK_KEY, scores?.[TIEBREAK_KEY]);
  return clean;
}

/** Validate players and reject duplicate linked accounts. */
function normalizePlayers(profile: ScoringProfile, input: unknown): PlayerInput[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > 8) return null;
  const players: PlayerInput[] = [];
  const seenUsers = new Set<string>();

  for (const entry of input) {
    if (!entry || typeof entry !== 'object') return null;
    const record = entry as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    if (!name) return null;
    const userId = typeof record.userId === 'string' && record.userId ? record.userId : null;
    if (userId) {
      if (seenUsers.has(userId)) return null; // each account only once
      seenUsers.add(userId);
    }
    players.push({
      id: typeof record.id === 'string' ? record.id : undefined,
      name: name.slice(0, 60),
      userId,
      scores: sanitizeScores(profile, (record.scores as ScoreMap) ?? {}),
    });
  }
  return players;
}

/**
 * Scoring rules that depend on the player count. Green end-of-round goals only
 * have a 3rd place when there are at least 3 players, for example.
 */
function validateScores(
  profile: ScoringProfile,
  players: PlayerInput[],
  playerCount: number,
): string | null {
  if (profile.goalBoard !== 'green') return null;
  const maxPlace = Math.min(3, playerCount);
  if (maxPlace >= 3) return null;
  for (const player of players) {
    for (let round = 1; round <= GOAL_ROUNDS; round += 1) {
      const value = player.scores?.[goalRoundKey(round)];
      if (typeof value === 'number' && value > maxPlace) {
        return `A placement of ${value} needs at least ${value} players.`;
      }
    }
  }
  return null;
}

async function writePlayers(
  env: Env,
  gameId: string,
  profile: ScoringProfile,
  ownerId: string,
  inputs: PlayerInput[],
): Promise<void> {
  const existingRows = await loadPlayerRows(env, gameId);
  const existingStatus = new Map(existingRows.map((row) => [row.id, row.status]));

  const computed = computeGame(
    profile,
    inputs.map((player) => ({ scores: player.scores ?? {} })),
  );
  const now = Date.now();

  const statements: D1PreparedStatement[] = [
    env.DB.prepare('DELETE FROM game_players WHERE game_id = ?').bind(gameId),
  ];

  inputs.forEach((input, index) => {
    const id = typeof input.id === 'string' && input.id.length > 0 ? input.id : crypto.randomUUID();
    // Owner and guests are accepted; other linked accounts must accept.
    let status: PlayerStatus = 'accepted';
    if (input.userId && input.userId !== ownerId) {
      status = existingStatus.get(id) ?? 'pending';
    }
    statements.push(
      env.DB.prepare(
        `INSERT INTO game_players
           (id, game_id, user_id, name, seat, status, scores, points, total, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id,
        gameId,
        input.userId ?? null,
        input.name,
        index,
        status,
        JSON.stringify(input.scores ?? {}),
        JSON.stringify(computed.perPlayer[index] ?? {}),
        computed.totals[index] ?? 0,
        now,
        now,
      ),
    );
  });

  await env.DB.batch(statements);
}

function configFromBody(body: Record<string, unknown>): GameConfig {
  return normalizeConfig({
    coreSets: Array.isArray(body.coreSets) ? (body.coreSets as CoreSet[]) : undefined,
    expansions: Array.isArray(body.expansions) ? (body.expansions as string[]) : undefined,
    goalBoard: (body.goalBoard as GoalBoard) ?? 'green',
  });
}

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

export const gameRoutes = new Hono<AppEnv>();

gameRoutes.use('*', requireAuth);

gameRoutes.get('/', async (c) => {
  const user = c.get('user');
  const games = await c.env.DB.prepare(
    `${VISIBLE_GAMES_SQL} ORDER BY g.played_at DESC, g.created_at DESC LIMIT 200`,
  )
    .bind(user.id, user.id)
    .all<GameRow>();
  const players = await c.env.DB.prepare('SELECT * FROM game_players').all<PlayerRow>();

  const playersByGame = new Map<string, PlayerRow[]>();
  for (const player of players.results) {
    const list = playersByGame.get(player.game_id) ?? [];
    list.push(player);
    playersByGame.set(player.game_id, list);
  }

  const summaries = games.results.map((row) => serializeSummary(row, playersByGame.get(row.id) ?? []));
  return c.json({ games: summaries });
});

gameRoutes.post('/', async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return c.json({ error: 'Invalid JSON body.' }, 400);

  const config = configFromBody(body);
  const profile = deriveProfile(config);
  const players = normalizePlayers(profile, body.players);
  if (!players) {
    return c.json({ error: 'A game needs 1–8 named players, each account only once.' }, 400);
  }

  const validation = validateConfig(config, players.length);
  if (!validation.valid) return c.json({ error: validation.error }, 400);
  const scoreError = validateScores(profile, players, players.length);
  if (scoreError) return c.json({ error: scoreError }, 400);

  const user = c.get('user');
  const status = STATUSES.includes(body.status as GameStatus)
    ? (body.status as GameStatus)
    : 'in_progress';

  const playedAt =
    typeof body.playedAt === 'number' && Number.isFinite(body.playedAt)
      ? body.playedAt
      : Date.now();

  const id = crypto.randomUUID();
  const now = Date.now();

  await c.env.DB.prepare(
    `INSERT INTO games
       (id, owner_id, played_at, status, core_sets, expansions, goal_board, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      user.id,
      playedAt,
      status,
      JSON.stringify(config.coreSets),
      JSON.stringify(config.expansions),
      config.goalBoard,
      typeof body.notes === 'string' ? body.notes.slice(0, 2000) : null,
      now,
      now,
    )
    .run();

  await writePlayers(c.env, id, profile, user.id, players);
  const game = await loadGame(c.env, id);
  return c.json({ game }, 201);
});

gameRoutes.get('/:id', async (c) => {
  const row = await loadGameRow(c.env, c.req.param('id'));
  if (!row || !(await canViewGame(c.env, row, c.get('user').id))) {
    return c.json({ error: 'Game not found.' }, 404);
  }
  const game = await loadGame(c.env, row.id);
  return c.json({ game });
});

gameRoutes.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await loadGameRow(c.env, id);
  if (!existing) return c.json({ error: 'Game not found.' }, 404);
  const user = c.get('user');
  if (existing.owner_id !== user.id) {
    return c.json({ error: 'Only the score master can edit this game.' }, 403);
  }

  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return c.json({ error: 'Invalid JSON body.' }, 400);

  const config =
    body.coreSets !== undefined ||
    body.expansions !== undefined ||
    body.goalBoard !== undefined
      ? configFromBody(body)
      : configForGame(existing);
  const profile = deriveProfile(config);
  const configChanged = profile.id !== profileForGame(existing).id;

  const status = STATUSES.includes(body.status as GameStatus)
    ? (body.status as GameStatus)
    : existing.status;
  const playedAt =
    typeof body.playedAt === 'number' && Number.isFinite(body.playedAt)
      ? body.playedAt
      : existing.played_at;
  const notes = typeof body.notes === 'string' ? body.notes.slice(0, 2000) : existing.notes;

  let inputs: PlayerInput[] | null = null;
  if (body.players !== undefined) {
    inputs = normalizePlayers(profile, body.players);
    if (!inputs) {
      return c.json({ error: 'A game needs 1–8 named players, each account only once.' }, 400);
    }
  }

  const playerCount =
    inputs?.length ??
    (await c.env.DB.prepare('SELECT COUNT(*) AS count FROM game_players WHERE game_id = ?')
      .bind(id)
      .first<{ count: number }>())?.count ??
    0;
  const validation = validateConfig(config, playerCount);
  if (!validation.valid) return c.json({ error: validation.error }, 400);
  if (inputs) {
    const scoreError = validateScores(profile, inputs, inputs.length);
    if (scoreError) return c.json({ error: scoreError }, 400);
  }

  const now = Date.now();
  await c.env.DB.prepare(
    `UPDATE games
        SET played_at = ?, status = ?, core_sets = ?, expansions = ?, goal_board = ?,
            notes = ?, updated_at = ?
      WHERE id = ?`,
  )
    .bind(
      playedAt,
      status,
      JSON.stringify(config.coreSets),
      JSON.stringify(config.expansions),
      config.goalBoard,
      notes,
      now,
      id,
    )
    .run();

  if (inputs) {
    await writePlayers(c.env, id, profile, existing.owner_id, inputs);
  } else if (configChanged) {
    const rows = await loadPlayerRows(c.env, id);
    await writePlayers(
      c.env,
      id,
      profile,
      existing.owner_id,
      rows.map((row) => ({
        id: row.id,
        name: row.name,
        userId: row.user_id,
        scores: parseJson<ScoreMap>(row.scores, {}),
      })),
    );
  }

  const game = await loadGame(c.env, id);
  return c.json({ game });
});

gameRoutes.post('/:id/accept', async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const row = await loadGameRow(c.env, id);
  if (!row || !(await canViewGame(c.env, row, user.id))) {
    return c.json({ error: 'Game not found.' }, 404);
  }

  const player = await c.env.DB.prepare(
    'SELECT * FROM game_players WHERE game_id = ? AND user_id = ?',
  )
    .bind(id, user.id)
    .first<PlayerRow>();
  if (!player) return c.json({ error: 'You are not invited to this game.' }, 400);
  if (player.status === 'accepted') return c.json({ game: await loadGame(c.env, id) });

  await c.env.DB.prepare('UPDATE game_players SET status = ?, updated_at = ? WHERE id = ?')
    .bind('accepted', Date.now(), player.id)
    .run();
  return c.json({ game: await loadGame(c.env, id) });
});

gameRoutes.post('/:id/decline', async (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const player = await c.env.DB.prepare(
    'SELECT * FROM game_players WHERE game_id = ? AND user_id = ?',
  )
    .bind(id, user.id)
    .first<PlayerRow>();
  if (!player) return c.json({ error: 'You are not invited to this game.' }, 400);
  if (player.status === 'accepted') {
    return c.json({ error: 'You have already joined this game.' }, 400);
  }
  await c.env.DB.prepare('DELETE FROM game_players WHERE id = ?').bind(player.id).run();
  return c.json({ ok: true });
});

gameRoutes.delete('/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await loadGameRow(c.env, id);
  if (!existing) return c.json({ error: 'Game not found.' }, 404);
  if (existing.owner_id !== c.get('user').id) {
    return c.json({ error: 'Only the score master can delete this game.' }, 403);
  }
  await c.env.DB.prepare('DELETE FROM games WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});
