import { api } from '../api';
import type { AuthUser, Game, GameSummary } from '../../shared/types';
import {
  createLocalGame,
  deleteLocalGame,
  getLocalGame,
  isLocalGameId,
  listLocalGames,
  updateLocalGame,
  type LocalGameInput,
} from './localGames';

/** The PATCH body the server expects. */
export function gamePayload(game: Game) {
  return {
    playedAt: game.playedAt,
    status: game.status,
    coreSets: game.coreSets,
    expansions: game.expansions,
    goalBoard: game.goalBoard,
    notes: game.notes,
    players: game.players.map((player) => ({
      id: player.id,
      name: player.name,
      userId: player.userId,
      scores: player.scores,
    })),
  };
}

export async function listGames(user: AuthUser | null): Promise<GameSummary[]> {
  if (!user) return listLocalGames();
  const result = await api<{ games: GameSummary[] }>('/api/games');
  return result.games;
}

export async function getGame(user: AuthUser | null, id: string): Promise<Game> {
  if (!user || isLocalGameId(id)) {
    const game = getLocalGame(id);
    if (!game) throw new Error('Game not found');
    return game;
  }
  const result = await api<{ game: Game }>(`/api/games/${id}`);
  return result.game;
}

export async function createGame(user: AuthUser | null, input: unknown): Promise<Game> {
  if (!user) return createLocalGame(input as LocalGameInput);
  const result = await api<{ game: Game }>('/api/games', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  return result.game;
}

export async function persistGame(user: AuthUser | null, game: Game): Promise<Game> {
  if (!user || isLocalGameId(game.id)) {
    const updated = updateLocalGame(game.id, game);
    if (!updated) throw new Error('Game not found');
    return updated;
  }
  const result = await api<{ game: Game }>(`/api/games/${game.id}`, {
    method: 'PATCH',
    body: JSON.stringify(gamePayload(game)),
  });
  return result.game;
}

export async function deleteGame(user: AuthUser | null, id: string): Promise<void> {
  if (!user || isLocalGameId(id)) {
    deleteLocalGame(id);
    return;
  }
  await api(`/api/games/${id}`, { method: 'DELETE' });
}
