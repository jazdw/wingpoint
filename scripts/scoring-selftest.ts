// Quick self-test for the shared scoring engine. Run with:
//   node --experimental-strip-types scripts/scoring-selftest.ts
import {
  checkComplete,
  computeGame,
  deriveProfile,
  goalPlacementIssues,
  goalPlaceOptions,
  normalizeConfig,
  resolveGoalPlacements,
  TIEBREAK_KEY,
  validateConfig,
} from '../shared/scoring.ts';

let failures = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) {
    failures += 1;
    console.error(`FAIL ${label}\n  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`);
  } else {
    console.log(`ok   ${label}`);
  }
}

const profile = (
  expansions: string[] = [],
  goalBoard: 'green' | 'blue' = 'green',
  modes: Array<'duet' | 'flock'> = [],
  coreSets: Array<'wingspan' | 'asia'> = ['wingspan'],
) => deriveProfile(normalizeConfig({ coreSets, expansions, goalBoard }), modes);

const forest = (counts: number[], expansions = ['oceania'], board: 'green' | 'blue' = 'green') => {
  const players = counts.map((n) => ({ scores: { nectar_forest: n } as Record<string, number | null> }));
  const { perPlayer } = computeGame(profile(expansions, board), players);
  return perPlayer.map((points) => points.nectar);
};

// Standard Oceania nectar: ties split the occupied places, rounded down.
check('nectar 5/3/0', forest([5, 3, 0]), [5, 2, 0]);
check('nectar 2-player second scores', forest([4, 1]), [5, 2]);
check('nectar two tied first split', forest([3, 3, 1]), [3, 3, 0]);
check('nectar three tied first', forest([3, 3, 3]), [2, 2, 2]);
check('nectar tie for second splits 2+0', forest([5, 3, 3]), [5, 1, 1]);
check('nectar zeros never score', forest([0, 0, 0]), [0, 0, 0]);
check(
  'flock nectar friendly ties',
  computeGame(
    profile(['oceania'], 'green', ['flock'], ['wingspan', 'asia']),
    [3, 3, 1].map((n) => ({ scores: { nectar_forest: n } as Record<string, number | null> })),
  ).perPlayer.map((points) => points.nectar),
  [5, 5, 2],
);

// Green end-of-round goals, official table with tie splitting.
const goalPoints = (placements: number[], round: number, expansions: string[] = []) => {
  const players = placements.map((place) => ({
    scores: { [`goalR${round}`]: place } as Record<string, number | null>,
  }));
  const { perPlayer } = computeGame(profile(expansions), players);
  return perPlayer.map((points) => points.endOfRoundGoals);
};
check('green goals 1/2/3', goalPoints([1, 2, 3], 1), [4, 1, 0]);
check('green goals two tied first split 4+1', goalPoints([1, 1], 1), [2, 2]);
check('green goals one first, two tied second', goalPoints([1, 2, 2], 1), [4, 0, 0]);
check('green goals three tied first round 4', goalPoints([1, 1, 1], 4), [4, 4, 4]);
check('green goals none scores 0', goalPoints([0, 0], 1), [0, 0]);

// Blue end-of-round goals: one point per item, capped at 5.
const blueTotal = computeGame(profile([], 'blue'), [
  { scores: { goalR1: 3, goalR2: 6, goalR3: 2, goalR4: 10 } },
]);
check('blue goals cap at 5', blueTotal.perPlayer.map((points) => points.endOfRoundGoals), [15]);

// Base total: bird/bonus/egg/food/tuck plus green goals 4+5+6+7.
const baseTotal = computeGame(profile([]), [
  {
    scores: {
      birds: 30,
      bonusCards: 5,
      eggs: 12,
      cachedFood: 3,
      tuckedCards: 4,
      goalR1: 1,
      goalR2: 1,
      goalR3: 1,
      goalR4: 1,
    },
  },
]);
check('base total', baseTotal.totals, [76]);

// Americas signed hummingbird track.
check(
  'signed hummingbird subtracts',
  computeGame(profile(['americas']), [{ scores: { birds: 50, hummingbirdTrack: -3 } }]).totals,
  [47],
);

// Unused food breaks a tie for the win.
check(
  'tiebreak: higher unused food wins',
  computeGame(profile([]), [
    { scores: { birds: 50, [TIEBREAK_KEY]: 1 } as Record<string, number | null> },
    { scores: { birds: 50, [TIEBREAK_KEY]: 4 } as Record<string, number | null> },
    { scores: { birds: 40, [TIEBREAK_KEY]: 9 } as Record<string, number | null> },
  ]).winners,
  [1],
);
check(
  'tiebreak: still tied shares the win',
  computeGame(profile([]), [
    { scores: { birds: 50, [TIEBREAK_KEY]: 2 } as Record<string, number | null> },
    { scores: { birds: 50, [TIEBREAK_KEY]: 2 } as Record<string, number | null> },
  ]).winners,
  [0, 1],
);

// Config validation.
check(
  'duet needs exactly 2 players',
  validateConfig(
    normalizeConfig({ coreSets: ['wingspan', 'asia'], goalBoard: 'green' }),
    3,
    ['duet'],
  ).valid,
  false,
);
check(
  'flock needs 6–7 players',
  validateConfig(
    normalizeConfig({ coreSets: ['wingspan', 'asia'], goalBoard: 'green' }),
    3,
    ['flock'],
  ).valid,
  false,
);
check(
  'flock requires asia',
  validateConfig(normalizeConfig({ coreSets: ['wingspan'], goalBoard: 'green' }), 6, ['flock'])
    .valid,
  false,
);
check(
  'asia standalone with duet is valid',
  validateConfig(normalizeConfig({ coreSets: ['asia'], goalBoard: 'green' }), 2, ['duet']).valid,
  true,
);
check(
  'base config is valid',
  validateConfig(normalizeConfig({ coreSets: ['wingspan'], goalBoard: 'blue' }), 4).valid,
  true,
);

// Completion checks.
const completeScores = {
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
const withGoals = (r1: number, r2: number, r3: number, r4: number) => ({
  ...completeScores,
  goalR1: r1,
  goalR2: r2,
  goalR3: r3,
  goalR4: r4,
});
check(
  'complete game passes',
  checkComplete(profile([]), [
    { name: 'A', scores: withGoals(1, 1, 1, 1) },
    { name: 'B', scores: withGoals(2, 2, 2, 2) },
  ]).valid,
  true,
);
check(
  'missing field fails',
  checkComplete(profile([]), [
    { name: 'A', scores: withGoals(1, 1, 1, 1) },
    { name: 'B', scores: { ...withGoals(2, 2, 2, 2), eggs: null } },
  ]).valid,
  false,
);
check(
  'inconsistent green placement fails',
  checkComplete(profile([]), [
    { name: 'A', scores: withGoals(1, 1, 1, 1) },
    { name: 'B', scores: withGoals(1, 1, 1, 1) },
    { name: 'C', scores: withGoals(2, 2, 2, 2) },
  ]).valid,
  false,
);
check(
  'tie then skip passes',
  checkComplete(profile([]), [
    { name: 'A', scores: withGoals(1, 1, 1, 1) },
    { name: 'B', scores: withGoals(1, 1, 1, 1) },
    { name: 'C', scores: withGoals(3, 3, 3, 3) },
  ]).valid,
  true,
);

// Green-board ranking helpers.
check('options after tie for 1st skip 2nd', goalPlaceOptions([1, 1, 0], 2), [0, 1, 3]);
check('options after single 1st', goalPlaceOptions([1, 0, 0], 1), [0, 1, 2, 3]);
check('options any order when empty', goalPlaceOptions([0, 0, 0], 0), [0, 1, 2, 3]);
check('2-player options have no 3rd', goalPlaceOptions([0, 0], 0), [0, 1, 2]);
check('3rd turned into 1st bumps old 2nd', resolveGoalPlacements([1, 2, 1]), [1, 3, 1]);
check('bump keeps relative order', resolveGoalPlacements([1, 2, 3, 1]), [1, 3, 0, 1]);
check('gaps are left for later entry', resolveGoalPlacements([0, 2, 0]), [0, 2, 0]);
check('issues: 2nd after tie is a conflict', goalPlacementIssues([1, 1, 2]), { conflicts: [2], gaps: [] });
check('issues: missing 1st is a gap', goalPlacementIssues([0, 2, 0]), { conflicts: [], gaps: [1] });
check('issues: 3rd in 2-player game', goalPlacementIssues([1, 3]), { conflicts: [], gaps: [1] });

// Player counts.
check('6 players rejected', validateConfig(normalizeConfig({}), 6).valid, false);
check('5 players ok', validateConfig(normalizeConfig({}), 5).valid, true);

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
}
console.log('\nAll scoring tests passed.');
