import { describe, expect, it } from 'vitest';
import { gamePayload } from './gameService';
import type { Game } from '../../shared/types';

describe('gamePayload', () => {
  it('sends only the editable parts, with scores keyed by player id', () => {
    const game: Game = {
      id: 'g1',
      ownerId: 'u1',
      ownerName: 'Alice',
      playedAt: 1,
      status: 'in_progress',
      coreSets: ['wingspan'],
      expansions: ['oceania'],
      goalBoard: 'green',
      notes: 'fun',
      players: [
        { id: 'p1', name: 'Alice', userId: 'u1', seat: 0, status: 'accepted', scores: { birds: 3 } },
        { id: 'p2', name: 'Guest', userId: null, seat: 1, status: 'accepted', scores: { birds: 5 } },
      ],
      createdAt: 1,
      updatedAt: 1,
    };
    expect(gamePayload(game)).toEqual({
      playedAt: 1,
      status: 'in_progress',
      notes: 'fun',
      scores: { p1: { birds: 3 }, p2: { birds: 5 } },
    });
  });
});
