// Quick self-test for the shared scoring engine. Run with:
//   node --experimental-strip-types scripts/scoring-selftest.ts
import { computeGame, TIEBREAK_KEY } from '../shared/scoring.ts';

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

const forest = (counts: number[], profileId = 'oceania') => {
  const players = counts.map((n) => ({ scores: { nectar_forest: n } as Record<string, number | null> }));
  const { perPlayer } = computeGame(profileId, players);
  return perPlayer.map((points) => points.nectar);
};

// Standard Oceania nectar: ties split the occupied places, rounded down.
check('nectar 5/3/0', forest([5, 3, 0]), [5, 2, 0]);
check('nectar 2-player second scores', forest([4, 1]), [5, 2]);
check('nectar two tied first split', forest([3, 3, 1]), [3, 3, 0]);
check('nectar three tied first', forest([3, 3, 3]), [2, 2, 2]);
check('nectar tie for second splits 2+0', forest([5, 3, 3]), [5, 1, 1]);
check('nectar zeros never score', forest([0, 0, 0]), [0, 0, 0]);
check('flock nectar friendly ties', forest([3, 3, 1], 'asia-flock-oceania'), [5, 5, 2]);

// End-of-round goals, official table with tie splitting.
const goalPoints = (placements: number[], round: number, profileId = 'base') => {
  const players = placements.map((place) => ({
    scores: { [`goalR${round}`]: place } as Record<string, number | null>,
  }));
  const { perPlayer } = computeGame(profileId, players);
  return perPlayer.map((points) => points.endOfRoundGoals);
};
check('round goal placements 1/2/3', goalPoints([1, 2, 3], 1), [4, 1, 0]);
check('round goal two tied first split 4+1', goalPoints([1, 1], 1), [2, 2]);
check('round goal one first, two tied second', goalPoints([1, 2, 2], 1), [4, 0, 0]);
check('round goal three tied first round 4', goalPoints([1, 1, 1], 4), [4, 4, 4]);
check('round goal none scores 0', goalPoints([0, 0], 1), [0, 0]);

// Base total: bird/bonus/egg/food/tuck plus goals 4+5+6+7.
const baseTotal = computeGame('base', [
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
  computeGame('americas', [{ scores: { birds: 50, hummingbirdTrack: -3 } }]).totals,
  [47],
);

// Unused food breaks a tie for the win.
check(
  'tiebreak: higher unused food wins',
  computeGame('base', [
    { scores: { birds: 50, [TIEBREAK_KEY]: 1 } as Record<string, number | null> },
    { scores: { birds: 50, [TIEBREAK_KEY]: 4 } as Record<string, number | null> },
    { scores: { birds: 40, [TIEBREAK_KEY]: 9 } as Record<string, number | null> },
  ]).winners,
  [1],
);
check(
  'tiebreak: still tied shares the win',
  computeGame('base', [
    { scores: { birds: 50, [TIEBREAK_KEY]: 2 } as Record<string, number | null> },
    { scores: { birds: 50, [TIEBREAK_KEY]: 2 } as Record<string, number | null> },
  ]).winners,
  [0, 1],
);

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
}
console.log('\nAll scoring tests passed.');
