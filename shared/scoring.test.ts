import { describe, expect, it } from 'vitest';
import {
  checkComplete,
  computeGame,
  computeGoalRound,
  deriveProfile,
  goalPlacesFromCounts,
  normalizeConfig,
  TIEBREAK_KEY,
  validateConfig,
  type ScoringMode,
} from './scoring';
import type { CoreSet, GoalBoard, ScoreMap } from './types';

const profile = (
  expansions: string[] = [],
  goalBoard: GoalBoard = 'green',
  modes: ScoringMode[] = [],
  coreSets: CoreSet[] = ['wingspan'],
) => deriveProfile(normalizeConfig({ coreSets, expansions, goalBoard }), modes);

const players = (scores: ScoreMap[]) => scores.map((entry) => ({ scores: entry }));

describe('Oceania nectar', () => {
  const forest = (counts: number[], modes: ScoringMode[] = []) =>
    computeGame(
      profile(['oceania'], 'green', modes, modes.length ? ['wingspan', 'asia'] : ['wingspan']),
      players(counts.map((n) => ({ nectar_forest: n }))),
    ).perPlayer.map((points) => points.nectar);

  it('awards 5 for most and 2 for second', () => {
    expect(forest([5, 3, 0])).toEqual([5, 2, 0]);
    expect(forest([4, 1])).toEqual([5, 2]);
  });
  it('splits tied places rounded down', () => {
    expect(forest([3, 3, 1])).toEqual([3, 3, 0]);
    expect(forest([3, 3, 3])).toEqual([2, 2, 2]);
    expect(forest([5, 3, 3])).toEqual([5, 1, 1]);
  });
  it('needs at least 1 nectar to score', () => {
    expect(forest([0, 0, 0])).toEqual([0, 0, 0]);
  });
  it('uses friendly ties in Flock mode', () => {
    expect(forest([3, 3, 1], ['flock'])).toEqual([5, 5, 2]);
  });
});

describe('green end-of-round goals (from item counts)', () => {
  it('ranks by count; ties share a place and skip the next', () => {
    expect(goalPlacesFromCounts([5, 3, 1])).toEqual([1, 2, 3]);
    expect(goalPlacesFromCounts([4, 4, 2])).toEqual([1, 1, 3]);
    expect(goalPlacesFromCounts([4, 2, 2])).toEqual([1, 2, 2]);
    expect(goalPlacesFromCounts([6, 5, 4, 3])).toEqual([1, 2, 3, 0]);
    expect(goalPlacesFromCounts([2, 2, 2, 2])).toEqual([1, 1, 1, 1]);
  });
  it('needs at least 1 item to place', () => {
    expect(goalPlacesFromCounts([3, 0, 0])).toEqual([1, 0, 0]);
    expect(goalPlacesFromCounts([0, 0])).toEqual([0, 0]);
  });
  it('scores the round table with tie splitting', () => {
    expect(computeGoalRound('green', 1, [3, 2, 1]).points).toEqual([4, 1, 0]);
    // Two tied for 1st in round 2: (5 + 2) / 2 = 3 each; 2nd is not awarded.
    expect(computeGoalRound('green', 2, [4, 4, 1])).toEqual({
      places: [1, 1, 3],
      points: [3, 3, 1],
    });
    // One 1st, two tied 2nd in round 1: (1 + 0) / 2 = 0.
    expect(computeGoalRound('green', 1, [5, 2, 2]).points).toEqual([4, 0, 0]);
    // Three tied 1st in round 4: (7 + 4 + 3) / 3 = 4.
    expect(computeGoalRound('green', 4, [1, 1, 1]).points).toEqual([4, 4, 4]);
    // Three tied 2nd in round 4: (4 + 3 + 0) / 3 = 2.
    expect(computeGoalRound('green', 4, [9, 1, 1, 1]).points).toEqual([7, 2, 2, 2]);
  });
  it('only has two places in a 2-player game', () => {
    expect(goalPlacesFromCounts([3, 1])).toEqual([1, 2]);
    expect(computeGoalRound('green', 1, [2, 2]).points).toEqual([2, 2]);
  });
});

describe('blue end-of-round goals', () => {
  it('scores 1 per item, capped at 5 per round', () => {
    expect(computeGoalRound('blue', 1, [3, 7, 0]).points).toEqual([3, 5, 0]);
    const game = computeGame(profile([], 'blue'), players([{ goalR1: 3, goalR2: 6, goalR3: 2, goalR4: 10 }]));
    expect(game.perPlayer[0].endOfRoundGoals).toBe(15);
  });
});

describe('totals and winners', () => {
  it('adds every category', () => {
    const game = computeGame(
      profile(),
      players([
        {
          birds: 30,
          bonusCards: 5,
          eggs: 12,
          cachedFood: 3,
          tuckedCards: 4,
          goalR1: 2,
          goalR2: 2,
          goalR3: 2,
          goalR4: 2,
        },
        { birds: 10, goalR1: 1, goalR2: 1, goalR3: 1, goalR4: 1 },
      ]),
    );
    // Goals: 4 + 5 + 6 + 7 for the first player, 1 + 2 + 3 + 4 for the second.
    expect(game.totals).toEqual([76, 20]);
  });
  it('lets the Americas hummingbird track go negative', () => {
    const game = computeGame(profile(['americas']), players([{ birds: 50, hummingbirdTrack: -3 }]));
    expect(game.totals).toEqual([47]);
  });
  it('breaks a tie with unused food, then shares the win', () => {
    const tied = (a: number, b: number) =>
      computeGame(
        profile(),
        players([
          { birds: 50, [TIEBREAK_KEY]: a },
          { birds: 50, [TIEBREAK_KEY]: b },
          { birds: 40, [TIEBREAK_KEY]: 9 },
        ]),
      ).winners;
    expect(tied(1, 4)).toEqual([1]);
    expect(tied(2, 2)).toEqual([0, 1]);
  });
});

describe('validateConfig', () => {
  const base = normalizeConfig({ coreSets: ['wingspan'] });
  const asia = normalizeConfig({ coreSets: ['wingspan', 'asia'] });
  it('allows 2–5 players', () => {
    expect(validateConfig(base, 1).valid).toBe(false);
    expect(validateConfig(base, 2).valid).toBe(true);
    expect(validateConfig(base, 5).valid).toBe(true);
    expect(validateConfig(base, 6).valid).toBe(false);
  });
  it('checks the Asia modes', () => {
    expect(validateConfig(asia, 3, ['duet']).valid).toBe(false);
    expect(validateConfig(normalizeConfig({ coreSets: ['asia'] }), 2, ['duet']).valid).toBe(true);
    expect(validateConfig(asia, 3, ['flock']).valid).toBe(false);
    expect(validateConfig(asia, 6, ['flock']).valid).toBe(true);
    expect(validateConfig(base, 6, ['flock']).valid).toBe(false);
  });
});

describe('checkComplete', () => {
  const full: ScoreMap = {
    birds: 1,
    bonusCards: 1,
    goalR1: 1,
    goalR2: 1,
    goalR3: 1,
    goalR4: 1,
    eggs: 1,
    cachedFood: 1,
    tuckedCards: 1,
  };
  it('passes when every field is filled in', () => {
    expect(checkComplete(profile(), [{ name: 'A', scores: full }]).valid).toBe(true);
  });
  it('reports each empty field', () => {
    const result = checkComplete(profile(), [
      { name: 'A', scores: full },
      { name: 'B', scores: { ...full, eggs: null } },
    ]);
    expect(result.valid).toBe(false);
    expect(result.fields).toEqual([{ player: 1, key: 'eggs' }]);
  });
});
