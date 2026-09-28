/**
 * Data-driven Wingspan scoring engine.
 *
 * A "profile" describes which score categories apply to a game (base game,
 * which expansions are mixed in, solo/duet mode, ...). Every category is a
 * simple counter except `nectar`, which uses the Oceania majority rule.
 *
 * Both the Worker and the React app import this module so the live UI and the
 * stored totals always agree. Adding a new expansion is a matter of adding a
 * category definition and a profile below.
 */

import type { ScoreMap } from './types';

export interface CategoryDef {
  id: string;
  label: string;
  short: string;
  help?: string;
  /** Defaults to 'counter' when omitted. */
  kind?: 'counter' | 'nectar';
  /** Points awarded per unit (default 1). */
  perUnit?: number;
  /** For nectar categories. */
  habitats?: { id: string; label: string; short: string }[];
}

export interface ScoringProfile {
  id: string;
  name: string;
  description: string;
  expansions: string[];
  categories: CategoryDef[];
  /**
   * How tied nectar majorities are handled.
   * - `split` (standard Oceania): combine the tied places' points and split evenly.
   * - `friendly` (Asia Flock mode): every tied player gets the full points and the
   *   next place is still available.
   */
  nectarTies?: 'split' | 'friendly';
}

export interface ExpansionDef {
  id: string;
  name: string;
  short: string;
}

export const EXPANSIONS: ExpansionDef[] = [
  { id: 'base', name: 'Base game', short: 'Base' },
  { id: 'european', name: 'European Expansion', short: 'Europe' },
  { id: 'oceania', name: 'Oceania Expansion', short: 'Oceania' },
  { id: 'asia', name: 'Asia Expansion', short: 'Asia' },
];

const BASE_CATEGORIES: CategoryDef[] = [
  { id: 'birds', label: 'Bird points', short: 'Birds', help: 'Points printed on the bird cards you played.' },
  { id: 'bonusCards', label: 'Bonus cards', short: 'Bonus', help: 'Points from your bonus cards.' },
  {
    id: 'endOfRoundGoals',
    label: 'End-of-round goals',
    short: 'Goals',
    help: 'Sum of the points you earned in the four end-of-round goals.',
  },
  { id: 'eggs', label: 'Eggs', short: 'Eggs', help: 'One point per egg on your birds.' },
  { id: 'cachedFood', label: 'Cached food', short: 'Food', help: 'One point per food token cached on your birds.' },
  { id: 'tuckedCards', label: 'Tucked cards', short: 'Tucked', help: 'One point per tucked card.' },
];

const NECTAR_AWARDS = [5, 2];

/** Repeated per habitat. Not part of the score total; used only to break ties. */
export const TIEBREAK_KEY = 'unusedFood';

export const NECTAR_HABITATS = [
  { id: 'forest', label: 'Forest nectar', short: 'Forest' },
  { id: 'grassland', label: 'Grassland nectar', short: 'Grass' },
  { id: 'wetland', label: 'Wetland nectar', short: 'Wet' },
];

const NECTAR_CATEGORY: CategoryDef = {
  id: 'nectar',
  label: 'Nectar',
  short: 'Nectar',
  kind: 'nectar',
  help: 'Most nectar in a habitat scores 5, second most scores 2 (3+ players).',
  habitats: NECTAR_HABITATS,
};

const DUET_CATEGORY: CategoryDef = {
  id: 'duetMap',
  label: 'Duet map',
  short: 'Duet',
  help: 'Points from duet tokens placed on the duet map.',
};

export const PROFILES: ScoringProfile[] = [
  {
    id: 'base',
    name: 'Base game',
    description: 'The original Wingspan score sheet.',
    expansions: ['base'],
    categories: BASE_CATEGORIES,
  },
  {
    id: 'european',
    name: 'Base + European',
    description: 'Base game with the European Expansion. Same score categories.',
    expansions: ['base', 'european'],
    categories: BASE_CATEGORIES,
  },
  {
    id: 'oceania',
    name: 'Base + European + Oceania',
    description: 'Oceania adds nectar, scored by majority in each habitat.',
    expansions: ['base', 'european', 'oceania'],
    categories: [...BASE_CATEGORIES, NECTAR_CATEGORY],
    nectarTies: 'split',
  },
  {
    id: 'asia',
    name: 'Base + Asia',
    description: 'Asia Expansion in competitive (non-duet) mode.',
    expansions: ['base', 'asia'],
    categories: BASE_CATEGORIES,
  },
  {
    id: 'asia-duet',
    name: 'Asia (Duet)',
    description: 'Asia Expansion duet mode. Adds duet map points.',
    expansions: ['base', 'asia'],
    categories: [...BASE_CATEGORIES, DUET_CATEGORY],
    nectarTies: 'friendly',
  },
  {
    id: 'asia-flock',
    name: 'Asia (Flock)',
    description: 'Asia Expansion flock mode (3–7 players). Same score categories as the base game.',
    expansions: ['base', 'asia'],
    categories: BASE_CATEGORIES,
    nectarTies: 'friendly',
  },
  {
    id: 'asia-flock-oceania',
    name: 'Asia (Flock) + Oceania',
    description: 'Asia flock mode mixed with Oceania. Nectar uses friendly ties.',
    expansions: ['base', 'asia', 'oceania'],
    categories: [...BASE_CATEGORIES, NECTAR_CATEGORY],
    nectarTies: 'friendly',
  },
];

export const DEFAULT_PROFILE_ID = 'base';

export function getProfile(profileId: string | null | undefined): ScoringProfile {
  return PROFILES.find((p) => p.id === profileId) ?? PROFILES[0];
}

/** Raw input key for a nectar habitat (e.g. `nectar_forest`). */
export function nectarKey(habitatId: string): string {
  return `nectar_${habitatId}`;
}

/** All raw score keys the UI should present for a profile. */
export function fieldKeys(profile: ScoringProfile): string[] {
  const keys: string[] = [];
  for (const category of profile.categories) {
    if (category.kind === 'nectar' && category.habitats) {
      for (const habitat of category.habitats) keys.push(nectarKey(habitat.id));
    } else {
      keys.push(category.id);
    }
  }
  return keys;
}

function toNumber(value: number | null | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  return value;
}

/**
 * Compute per-player category points and totals.
 *
 * Nectar majority is a cross-player calculation, so this always operates on
 * the full set of players in a game.
 */
export function computeGame(
  profileId: string,
  players: { scores: ScoreMap }[],
): {
  profile: ScoringProfile;
  perPlayer: Record<string, number>[];
  totals: number[];
  winners: number[];
} {
  const profile = getProfile(profileId);
  const perPlayer: Record<string, number>[] = players.map(() => ({}));

  // Plain counters first.
  profile.categories.forEach((category) => {
    if (category.kind === 'nectar') return;
    const perUnit = category.perUnit ?? 1;
    players.forEach((player, index) => {
      perPlayer[index][category.id] = toNumber(player.scores[category.id]) * perUnit;
    });
  });

  // Nectar majority.
  const nectarCategory = profile.categories.find((c) => c.kind === 'nectar');
  const friendlyTies = (profile.nectarTies ?? 'split') === 'friendly';
  if (nectarCategory?.habitats) {
    players.forEach((_, index) => {
      perPlayer[index][nectarCategory.id] = 0;
    });

    for (const habitat of nectarCategory.habitats) {
      const key = nectarKey(habitat.id);
      const counts = players.map((player) => toNumber(player.scores[key]));
      // Descending groups of equal counts (players with 0 cannot score).
      const ranked = [...new Set(counts.filter((n) => n > 0))].sort((a, b) => b - a);
      let position = 0;

      for (const count of ranked) {
        const groupSize = counts.filter((value) => value === count).length;
        let points: number;
        if (friendlyTies) {
          points = NECTAR_AWARDS[position] ?? 0;
          position += 1;
        } else {
          // Combine the points for every place the tied group occupies, then split.
          let available = 0;
          for (let place = position; place < position + groupSize; place += 1) {
            available += NECTAR_AWARDS[place] ?? 0;
          }
          points = Math.floor(available / groupSize);
          position += groupSize;
        }
        counts.forEach((value, index) => {
          if (value === count) perPlayer[index][nectarCategory.id] += points;
        });
      }
    }
  }

  const totals = perPlayer.map((scores) =>
    Object.values(scores).reduce((sum, value) => sum + value, 0),
  );

  // Highest total wins; ties are broken by unused food, then shared.
  const best = totals.length ? Math.max(...totals) : 0;
  const contenders = totals
    .map((total, index) => (total === best && best > 0 ? index : -1))
    .filter((index) => index >= 0);
  const unusedFood = (index: number) => toNumber(players[index]?.scores[TIEBREAK_KEY]);
  const bestFood = contenders.length ? Math.max(...contenders.map(unusedFood)) : 0;
  const winners = contenders.filter((index) => unusedFood(index) === bestFood);

  return { profile, perPlayer, totals, winners };
}

/** Convenience helper for a single player's computed points. */
export function computePlayerPoints(profileId: string, scores: ScoreMap): Record<string, number> {
  const { perPlayer } = computeGame(profileId, [{ scores }]);
  return perPlayer[0] ?? {};
}

export function emptyScores(profile: ScoringProfile): ScoreMap {
  const scores: ScoreMap = {};
  for (const key of fieldKeys(profile)) scores[key] = null;
  scores[TIEBREAK_KEY] = null;
  return scores;
}
