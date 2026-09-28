import { computeGame, deriveProfile, emptyScores, normalizeConfig } from '../../shared/scoring';
import type { CoreSet, Game, GameStatus, GameSummary, GoalBoard } from '../../shared/types';
import { newId } from './id';

const STORAGE_KEY = 'wp-local-games';
export const LOCAL_PREFIX = 'local:';

export interface LocalGameInput {
  coreSets: CoreSet[];
  expansions: string[];
  goalBoard: GoalBoard;
  players: { id?: string; name: string }[];
  playedAt?: number;
  status?: GameStatus;
}

export function isLocalGameId(id: string): boolean {
  return id.startsWith(LOCAL_PREFIX);
}

function readAll(): Game[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Game[]) : [];
  } catch {
    return [];
  }
}

function writeAll(games: Game[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(games));
  } catch {
    // ignore storage errors
  }
}

function configOf(game: Game) {
  return normalizeConfig({
    coreSets: game.coreSets,
    expansions: game.expansions,
    goalBoard: game.goalBoard,
  });
}

function summarize(game: Game): GameSummary {
  const profile = deriveProfile(configOf(game));
  const computed = computeGame(
    profile,
    game.players.map((player) => ({ scores: player.scores })),
  );
  return {
    id: game.id,
    ownerId: game.ownerId,
    playedAt: game.playedAt,
    status: game.status,
    coreSets: game.coreSets,
    expansions: game.expansions,
    goalBoard: game.goalBoard,
    scored: computed.totals.some((total) => total > 0),
    players: game.players.map((player, index) => ({
      id: player.id,
      name: player.name,
      userId: player.userId,
      status: player.status,
      total: computed.totals[index] ?? 0,
    })),
    winners: computed.winners.map((index) => game.players[index]?.id).filter(Boolean) as string[],
    createdAt: game.createdAt,
    updatedAt: game.updatedAt,
  };
}

export function listLocalGames(): GameSummary[] {
  return readAll()
    .map(summarize)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getLocalGame(id: string): Game | null {
  return readAll().find((game) => game.id === id) ?? null;
}

export function createLocalGame(input: LocalGameInput): Game {
  const now = Date.now();
  const config = normalizeConfig({
    coreSets: input.coreSets,
    expansions: input.expansions,
    goalBoard: input.goalBoard,
  });
  const profile = deriveProfile(config);
  const game: Game = {
    id: `${LOCAL_PREFIX}${newId()}`,
    ownerId: 'local',
    playedAt: input.playedAt ?? now,
    status: input.status ?? 'in_progress',
    coreSets: config.coreSets,
    expansions: config.expansions,
    goalBoard: config.goalBoard,
    notes: null,
    players: input.players.map((player, index) => ({
      id: player.id ?? newId(),
      name: player.name,
      userId: null,
      seat: index,
      status: 'accepted',
      scores: emptyScores(profile),
    })),
    createdAt: now,
    updatedAt: now,
  };
  writeAll([...readAll(), game]);
  return game;
}

export function updateLocalGame(id: string, patch: Partial<Game>): Game | null {
  const games = readAll();
  const index = games.findIndex((game) => game.id === id);
  if (index === -1) return null;
  const updated: Game = {
    ...games[index],
    ...patch,
    id,
    ownerId: 'local',
    updatedAt: Date.now(),
  };
  games[index] = updated;
  writeAll(games);
  return updated;
}

export function deleteLocalGame(id: string): void {
  writeAll(readAll().filter((game) => game.id !== id));
}
