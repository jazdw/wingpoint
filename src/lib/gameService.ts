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

/**
 * The PATCH body the server expects. The setup and roster are fixed after
 * creation, so only the editable parts are sent, with scores keyed by player.
 */
export function gamePayload(game: Game) {
  return {
    playedAt: game.playedAt,
    status: game.status,
    notes: game.notes,
    scores: Object.fromEntries(game.players.map((player) => [player.id, player.scores])),
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
  if (isLocalGameId(game.id)) {
    const updated = updateLocalGame(game.id, game);
    if (!updated) throw new Error('Game not found');
    return updated;
  }
  if (!user) throw new Error('Not signed in');
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
