import { Hono } from 'hono';
import {
  computeGame,
  DEFAULT_PROFILE_ID,
  GOAL_ROUNDS,
  goalRoundKey,
  getProfile,
  nectarKey,
  PROFILES,
  TIEBREAK_KEY,
} from '../shared/scoring';
import type { Game, GameMode, GamePlayer, GameStatus, GameSummary, ScoreMap } from '../shared/types';
import { requireAuth } from './auth';
import type { AppEnv, Env } from './env';
import { isGroupMember } from './groups';

/* ------------------------------------------------------------------ */
/* Row types & serialization                                           */
/* ------------------------------------------------------------------ */

export interface GameRow {
  id: string;
  owner_id: string;
  group_id: string | null;
  played_at: number;
  mode: GameMode;
  status: GameStatus;
  scoring_profile: string;
  expansions: string;
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

function serializePlayer(row: PlayerRow): GamePlayer {
  return {
    id: row.id,
    name: row.name,
    userId: row.user_id,
    seat: row.seat,
    scores: parseJson<ScoreMap>(row.scores, {}),
  };
}

function serializeGame(row: GameRow, players: PlayerRow[]): Game {
  return {
    id: row.id,
    ownerId: row.owner_id,
    groupId: row.group_id,
    playedAt: row.played_at,
    mode: row.mode,
    status: row.status,
    scoringProfile: row.scoring_profile,
    expansions: parseJson<string[]>(row.expansions, []),
    notes: row.notes,
    players: players.map(serializePlayer),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function serializeSummary(row: GameRow, players: PlayerRow[]): GameSummary {
  const ordered = [...players].sort((a, b) => a.seat - b.seat);
  const game = {
    scoringProfile: row.scoring_profile,
  };
  const computed = computeGame(
    game.scoringProfile,
    ordered.map((player) => ({ scores: parseJson<ScoreMap>(player.scores, {}) })),
  );
  const winners = computed.winners.map((index) => ordered[index]?.id).filter(Boolean) as string[];
  return {
    id: row.id,
    groupId: row.group_id,
    playedAt: row.played_at,
    mode: row.mode,
    status: row.status,
    scoringProfile: row.scoring_profile,
    expansions: parseJson<string[]>(row.expansions, []),
    scored: computed.totals.some((total) => total > 0),
    players: ordered.map((player, index) => ({
      id: player.id,
      name: player.name,
      userId: player.user_id,
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

/** SQL selecting games visible to a user (owner or member of the game's group). */
export const VISIBLE_GAMES_SQL = `SELECT DISTINCT g.*
   FROM games g
   LEFT JOIN group_members m ON m.group_id = g.group_id AND m.user_id = ?
  WHERE g.owner_id = ? OR m.user_id IS NOT NULL`;

export async function canViewGame(env: Env, game: GameRow, userId: string): Promise<boolean> {
  if (game.owner_id === userId) return true;
  if (!game.group_id) return false;
  return isGroupMember(env, game.group_id, userId);
}

/* ------------------------------------------------------------------ */
/* Validation & writes                                                 */
/* ------------------------------------------------------------------ */

const MODES: GameMode[] = ['competitive', 'solo', 'coop'];
const STATUSES: GameStatus[] = ['in_progress', 'completed'];
const KNOWN_EXPANSIONS = new Set(['base', 'european', 'oceania', 'asia', 'americas']);

interface PlayerInput {
  id?: string;
  name: string;
  userId?: string | null;
  scores?: ScoreMap;
}

export function isValidProfile(id: unknown): id is string {
  return typeof id === 'string' && PROFILES.some((profile) => profile.id === id);
}

function sanitizeScores(profileId: string, scores: ScoreMap | undefined): ScoreMap {
  const profile = getProfile(profileId);
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
        put(key, scores?.[key], false, 3);
      }
    } else {
      put(category.id, scores?.[category.id], category.kind === 'signed');
    }
  }

  put(TIEBREAK_KEY, scores?.[TIEBREAK_KEY]);
  return clean;
}

function normalizePlayers(profileId: string, input: unknown): PlayerInput[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > 8) return null;
  const players: PlayerInput[] = [];
  for (const entry of input) {
    if (!entry || typeof entry !== 'object') return null;
    const record = entry as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    if (!name) return null;
    players.push({
      id: typeof record.id === 'string' ? record.id : undefined,
      name: name.slice(0, 60),
      userId: typeof record.userId === 'string' ? record.userId : null,
      scores: sanitizeScores(profileId, (record.scores as ScoreMap) ?? {}),
    });
  }
  return players;
}

async function writePlayers(
  env: Env,
  gameId: string,
  profileId: string,
  inputs: PlayerInput[],
): Promise<GamePlayer[]> {
  const computed = computeGame(
    profileId,
    inputs.map((player) => ({ scores: player.scores ?? {} })),
  );
  const now = Date.now();

  const statements: D1PreparedStatement[] = [
    env.DB.prepare('DELETE FROM game_players WHERE game_id = ?').bind(gameId),
  ];

  const players: GamePlayer[] = inputs.map((input, index) => {
    const id = typeof input.id === 'string' && input.id.length > 0 ? input.id : crypto.randomUUID();
    const scores = input.scores ?? {};
    statements.push(
      env.DB.prepare(
        `INSERT INTO game_players
           (id, game_id, user_id, name, seat, scores, points, total, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id,
        gameId,
        input.userId ?? null,
        input.name,
        index,
        JSON.stringify(scores),
        JSON.stringify(computed.perPlayer[index] ?? {}),
        computed.totals[index] ?? 0,
        now,
        now,
      ),
    );
    return { id, name: input.name, userId: input.userId ?? null, seat: index, scores };
  });

  await env.DB.batch(statements);
  return players;
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

  const profileId = isValidProfile(body.scoringProfile) ? body.scoringProfile : DEFAULT_PROFILE_ID;
  const players = normalizePlayers(profileId, body.players);
  if (!players) return c.json({ error: 'A game needs between 1 and 8 named players.' }, 400);

  const mode = MODES.includes(body.mode as GameMode) ? (body.mode as GameMode) : 'competitive';
  const status = STATUSES.includes(body.status as GameStatus)
    ? (body.status as GameStatus)
    : 'in_progress';
  const playedAt =
    typeof body.playedAt === 'number' && Number.isFinite(body.playedAt)
      ? body.playedAt
      : Date.now();
  const expansions = Array.isArray(body.expansions)
    ? body.expansions.filter((value): value is string => typeof value === 'string' && KNOWN_EXPANSIONS.has(value))
    : getProfile(profileId).expansions;

  const user = c.get('user');
  const groupId =
    typeof body.groupId === 'string' && body.groupId.length > 0 ? body.groupId : null;
  if (groupId && !(await isGroupMember(c.env, groupId, user.id))) {
    return c.json({ error: 'You are not a member of that group.' }, 403);
  }

  const id = crypto.randomUUID();
  const now = Date.now();

  await c.env.DB.prepare(
    `INSERT INTO games
       (id, owner_id, group_id, played_at, mode, status, scoring_profile, expansions, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      user.id,
      groupId,
      playedAt,
      mode,
      status,
      profileId,
      JSON.stringify(expansions),
      typeof body.notes === 'string' ? body.notes.slice(0, 2000) : null,
      now,
      now,
    )
    .run();

  await writePlayers(c.env, id, profileId, players);
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
  if (existing.owner_id !== c.get('user').id) {
    return c.json({ error: 'Only the score master can edit this game.' }, 403);
  }

  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return c.json({ error: 'Invalid JSON body.' }, 400);

  const profileId = isValidProfile(body.scoringProfile)
    ? body.scoringProfile
    : existing.scoring_profile;
  const profileChanged = profileId !== existing.scoring_profile;

  const mode = MODES.includes(body.mode as GameMode) ? (body.mode as GameMode) : existing.mode;
  const status = STATUSES.includes(body.status as GameStatus)
    ? (body.status as GameStatus)
    : existing.status;
  const playedAt =
    typeof body.playedAt === 'number' && Number.isFinite(body.playedAt)
      ? body.playedAt
      : existing.played_at;
  const expansions = Array.isArray(body.expansions)
    ? body.expansions.filter((value): value is string => typeof value === 'string' && KNOWN_EXPANSIONS.has(value))
    : parseJson<string[]>(existing.expansions, []);
  const notes =
    typeof body.notes === 'string' ? body.notes.slice(0, 2000) : existing.notes;

  const groupId =
    typeof body.groupId === 'string' && body.groupId.length > 0
      ? body.groupId
      : body.groupId === null
        ? null
        : existing.group_id;
  if (
    groupId &&
    groupId !== existing.group_id &&
    !(await isGroupMember(c.env, groupId, c.get('user').id))
  ) {
    return c.json({ error: 'You are not a member of that group.' }, 403);
  }

  const now = Date.now();
  await c.env.DB.prepare(
    `UPDATE games
        SET played_at = ?, mode = ?, status = ?, scoring_profile = ?, expansions = ?, notes = ?, group_id = ?, updated_at = ?
      WHERE id = ?`,
  )
    .bind(playedAt, mode, status, profileId, JSON.stringify(expansions), notes, groupId, now, id)
    .run();

  if (body.players !== undefined) {
    const players = normalizePlayers(profileId, body.players);
    if (!players) return c.json({ error: 'A game needs between 1 and 8 named players.' }, 400);
    await writePlayers(c.env, id, profileId, players);
  } else if (profileChanged) {
    const rows = await loadPlayerRows(c.env, id);
    await writePlayers(
      c.env,
      id,
      profileId,
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
