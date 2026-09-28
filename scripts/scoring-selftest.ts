// Quick self-test for the shared scoring engine. Run with:
//   node --experimental-strip-types scripts/scoring-selftest.ts
import { computeGame, PROFILES, TIEBREAK_KEY } from '../shared/scoring.ts';

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

function nectarProfile(id: string) {
  const profile = PROFILES.find((p) => p.id === id);
  if (!profile) throw new Error(`missing profile ${id}`);
  return profile;
}

// Standard Oceania: two tied for first split 5+2 => 3 each; next gets 0.
const standard = nectarProfile('oceania');
computeGame(standard.id, []);
const forest = (counts: number[], profileId = 'oceania') => {
  const players = counts.map((n) => ({ scores: { nectar_forest: n } as Record<string, number | null> }));
  const { perPlayer } = computeGame(profileId, players);
  return perPlayer.map((points) => points.nectar);
};

check('standard: 5/3/0', forest([5, 3, 0]), [5, 2, 0]);
check('standard: 2-player second scores', forest([4, 1]), [5, 2]);
check('standard: two tied first split', forest([3, 3, 1]), [3, 3, 0]);
check('standard: three tied first', forest([3, 3, 3]), [2, 2, 2]);
check('standard: tie for second splits 2+0', forest([5, 3, 3]), [5, 1, 1]);
check('standard: zeros never score', forest([0, 0, 0]), [0, 0, 0]);

// Asia Flock: friendly ties keep second place available.
check('flock: two tied first keep 5', forest([3, 3, 1], 'asia-flock-oceania'), [5, 5, 2]);

// Unused food breaks a tie for the win.
const basePlayers = [
  { scores: { birds: 50, [TIEBREAK_KEY]: 1 } as Record<string, number | null> },
  { scores: { birds: 50, [TIEBREAK_KEY]: 4 } as Record<string, number | null> },
  { scores: { birds: 40, [TIEBREAK_KEY]: 9 } as Record<string, number | null> },
];
const baseResult = computeGame('base', basePlayers);
check('tiebreak: higher unused food wins', baseResult.winners, [1]);

const sharedPlayers = [
  { scores: { birds: 50, [TIEBREAK_KEY]: 2 } as Record<string, number | null> },
  { scores: { birds: 50, [TIEBREAK_KEY]: 2 } as Record<string, number | null> },
];
check('tiebreak: still tied shares the win', computeGame('base', sharedPlayers).winners, [0, 1]);

// Base total is the sum of its categories.
const baseTotal = computeGame('base', [
  { scores: { birds: 30, bonusCards: 5, endOfRoundGoals: 7, eggs: 12, cachedFood: 3, tuckedCards: 4 } },
]);
check('base total', baseTotal.totals, [61]);

if (failures > 0) {
  console.error(`\n${failures} test(s) failed.`);
  process.exit(1);
}
console.log('\nAll scoring tests passed.');
