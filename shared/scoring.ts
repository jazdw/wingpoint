/**
 * Data-driven Wingspan scoring engine.
 *
 * A game's categories are derived from its configuration: which expansions are
 * mixed in, which end-of-round goal board side is used (green majority or blue
 * one-point-per-item), and — when Asia is included — whether it is Duet or
 * Flock mode. Special category kinds:
 *
 *  - `nectar`      majority scoring per habitat (Oceania)
 *  - `roundGoals`  the four end-of-round goals, entered as item counts: ranked
 *                  on the green board (ties split points), or 1 pt per item
 *                  capped at 5 on the blue board
 *  - `signed`      may be negative (Americas hummingbird track)
 *
 * Both the Worker and the React app import this module so the live UI and the
 * stored totals always agree.
 */

import type { CoreSet, GameConfig, GoalBoard, ScoreMap } from './types';

/**
 * Optional Wingspan Asia play modes. Deliberately not persisted yet: the scoring
 * engine accepts them so a `play_mode` column can be added back later without
 * touching the scoring logic.
 */
export type ScoringMode = 'duet' | 'flock';

export interface CategoryDef {
  id: string;
  label: string;
  short: string;
  help?: string;
  /** Defaults to 'counter' when omitted. */
  kind?: 'counter' | 'nectar' | 'roundGoals' | 'signed';
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
  goalBoard: GoalBoard;
  /**
   * How tied nectar majorities are handled.
   * - `split` (standard Oceania): combine the tied places' points and split evenly.
   * - `friendly` (Asia Flock mode): every tied player gets the full points and the
   *   next place is still available.
   */
  nectarTies?: 'split' | 'friendly';
}

export interface SetDef {
  id: string;
  name: string;
  short: string;
}

/** Standalone sets — choose at least one. */
export const CORE_SETS: SetDef[] = [
  { id: 'wingspan', name: 'Wingspan (base game)', short: 'Wingspan' },
  { id: 'asia', name: 'Wingspan Asia (standalone)', short: 'Asia' },
];

/** Expansion sets — choose zero or more. */
export const EXPANSIONS: SetDef[] = [
  { id: 'european', name: 'European Expansion', short: 'Europe' },
  { id: 'oceania', name: 'Oceania Expansion', short: 'Oceania' },
  { id: 'americas', name: 'Americas Expansion', short: 'Americas' },
];

/** Expansions the user can tick, in display order. */
export const SELECTABLE_EXPANSIONS = EXPANSIONS;

/* ------------------------------------------------------------------ */
/* End-of-round goals                                                  */
/* ------------------------------------------------------------------ */

export const GOAL_ROUNDS = 4;

/**
 * Official green (majority) end-of-round goal points by round (round 1..4) and
 * place (1st, 2nd, 3rd). Later rounds are worth more.
 */
export const ROUND_GOAL_POINTS: number[][] = [
  [4, 1, 0],
  [5, 2, 1],
  [6, 3, 2],
  [7, 4, 3],
];

export const GOAL_PLACES = [
  { value: 1, label: '1st' },
  { value: 2, label: '2nd' },
  { value: 3, label: '3rd' },
];

export const BLUE_GOAL_CAP = 5;

/** Standard Wingspan player counts (Asia Flock mode would allow up to 7). */
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 5;
const MAX_FLOCK_PLAYERS = 7;

export function goalRoundKey(round: number): string {
  return `goalR${round}`;
}

/**
 * Green board: rank players by how many of the goal item they have. A player
 * needs at least 1 to place. Tied players share a place and the next place is
 * skipped (standard competition ranking), so two tied for 1st are followed by
 * 3rd. Anyone below 3rd gets no place (0 = no place).
 */
export function goalPlacesFromCounts(counts: number[]): number[] {
  return counts.map((count) => {
    if (count < 1) return 0;
    const place = 1 + counts.filter((other) => other > count).length;
    return place <= GOAL_PLACES.length ? place : 0;
  });
}

export interface GoalRoundResult {
  /** Green board place per player (0 = none); all 0 on the blue board. */
  places: number[];
  points: number[];
}

/** Places and points for one end-of-round goal from each player's item count. */
export function computeGoalRound(
  board: GoalBoard,
  round: number,
  counts: (number | null | undefined)[],
): GoalRoundResult {
  const clean = counts.map((count) => Math.max(0, Math.round(toNumber(count))));
  if (board === 'blue') {
    return {
      places: clean.map(() => 0),
      points: clean.map((count) => Math.min(BLUE_GOAL_CAP, count)),
    };
  }
  const places = goalPlacesFromCounts(clean);
  return { places, points: computeGoalRoundPoints(places, round) };
}

/* ------------------------------------------------------------------ */
/* Categories                                                          */
/* ------------------------------------------------------------------ */

const BIRDS: CategoryDef = {
  id: 'birds',
  label: 'Bird points',
  short: 'Birds',
  help: 'Points printed on the bird cards you played.',
};
const BONUS_CARDS: CategoryDef = {
  id: 'bonusCards',
  label: 'Bonus cards',
  short: 'Bonus',
  help: 'Points from your bonus cards.',
};
const EGGS: CategoryDef = { id: 'eggs', label: 'Eggs', short: 'Eggs', help: 'One point per egg on your birds.' };
const CACHED_FOOD: CategoryDef = {
  id: 'cachedFood',
  label: 'Cached food',
  short: 'Food',
  help: 'One point per food token cached on your birds.',
};
const TUCKED_CARDS: CategoryDef = {
  id: 'tuckedCards',
  label: 'Tucked cards',
  short: 'Tucked',
  help: 'One point per tucked card.',
};
const ROUND_GOALS: CategoryDef = {
  id: 'endOfRoundGoals',
  label: 'End-of-round goals',
  short: 'Goals',
  kind: 'roundGoals',
};

const NECTAR_AWARDS = [5, 2];

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
  help: 'Most nectar in a habitat scores 5, second most scores 2.',
  habitats: NECTAR_HABITATS,
};

const DUET_CATEGORY: CategoryDef = {
  id: 'duetMap',
  label: 'Duet map',
  short: 'Duet',
  help: 'Points from your largest contiguous group of Duet tokens on the map.',
};

const HUMMINGBIRD_CATEGORY: CategoryDef = {
  id: 'hummingbirdTrack',
  label: 'Hummingbird track',
  short: 'Humm.',
  kind: 'signed',
  help: 'Net points from your hummingbird track. May be negative.',
};

/* ------------------------------------------------------------------ */
/* Configuration                                                       */
/* ------------------------------------------------------------------ */

export function normalizeConfig(config: Partial<GameConfig> | null | undefined): GameConfig {
  const coreSets = Array.isArray(config?.coreSets)
    ? [...new Set(config!.coreSets.filter((id): id is CoreSet => id === 'wingspan' || id === 'asia'))]
    : (['wingspan'] as CoreSet[]);
  coreSets.sort((a, b) => a.localeCompare(b));

  const expansions = Array.isArray(config?.expansions)
    ? [...new Set(config!.expansions.filter((id) => EXPANSIONS.some((e) => e.id === id)))]
    : [];
  expansions.sort((a, b) => a.localeCompare(b));

  return {
    coreSets,
    expansions,
    goalBoard: config?.goalBoard === 'blue' ? 'blue' : 'green',
  };
}

export function configProfileId(config: GameConfig, modes: ScoringMode[] = []): string {
  return [config.goalBoard, ...config.coreSets, ...config.expansions, ...modes].join('|');
}

export function configName(config: GameConfig, modes: ScoringMode[] = []): string {
  const core = config.coreSets.map(
    (id) => CORE_SETS.find((set) => set.id === id)?.short ?? id,
  );
  const expansions = config.expansions.map(
    (id) => EXPANSIONS.find((set) => set.id === id)?.short ?? id,
  );
  let name = [...core, ...expansions].join(' + ');
  if (modes.includes('duet')) name += ' (Duet)';
  else if (modes.includes('flock')) name += ' (Flock)';
  name += config.goalBoard === 'blue' ? ' · Blue goals' : ' · Green goals';
  return name;
}

/**
 * Build the scoring profile for a game. `modes` is empty for now; pass Asia
 * Duet/Flock modes here once they are persisted again.
 */
export function deriveProfile(config: GameConfig, modes: ScoringMode[] = []): ScoringProfile {
  const hasAsia = config.coreSets.includes('asia');
  const expansions = new Set(config.expansions);
  // Ordered by when scoring happens: the end-of-round goals are scored during
  // the rounds, then the end-of-game tally.
  const categories: CategoryDef[] = [
    { ...ROUND_GOALS, help: goalBoardHelp(config.goalBoard) },
    BIRDS,
    BONUS_CARDS,
    EGGS,
    CACHED_FOOD,
    TUCKED_CARDS,
  ];

  if (expansions.has('oceania')) categories.push(NECTAR_CATEGORY);
  if (hasAsia && modes.includes('duet')) categories.push(DUET_CATEGORY);
  if (expansions.has('americas')) categories.push(HUMMINGBIRD_CATEGORY);

  const nectarTies = hasAsia && modes.includes('flock') ? 'friendly' : 'split';

  return {
    id: configProfileId(config, modes),
    name: configName(config, modes),
    description: 'Derived from the selected sets, goal board and play modes.',
    expansions: [...config.coreSets, ...config.expansions],
    categories,
    goalBoard: config.goalBoard,
    nectarTies,
  };
}

function goalBoardHelp(board: GoalBoard): string {
  return board === 'green'
    ? 'Green board: enter how many of the goal item each player has. Most is 1st; ties share the combined points (rounded down) and the next place is skipped. You need at least 1 to place.'
    : 'Blue board: enter how many of the goal item each player has. One point per item, up to 5 per round.';
}

export interface ConfigValidation {
  valid: boolean;
  error?: string;
}

export function validateConfig(
  config: GameConfig,
  playerCount: number,
  modes: ScoringMode[] = [],
): ConfigValidation {
  const hasAsia = config.coreSets.includes('asia');
  if (config.coreSets.length === 0) {
    return { valid: false, error: 'Choose at least one standalone set.' };
  }
  if (playerCount < MIN_PLAYERS) {
    return { valid: false, error: `A game needs at least ${MIN_PLAYERS} players.` };
  }
  const maxPlayers = modes.includes('flock') ? MAX_FLOCK_PLAYERS : MAX_PLAYERS;
  if (playerCount > maxPlayers) {
    return { valid: false, error: `Wingspan is played with at most ${maxPlayers} players.` };
  }
  if (modes.includes('duet')) {
    if (!hasAsia) return { valid: false, error: 'Duet mode requires Wingspan Asia.' };
    if (playerCount !== 2) {
      return { valid: false, error: 'Asia Duet mode is played with exactly 2 players.' };
    }
  }
  if (modes.includes('flock')) {
    if (!hasAsia) return { valid: false, error: 'Flock mode requires Wingspan Asia.' };
    if (playerCount < 6 || playerCount > 7) {
      return { valid: false, error: 'Asia Flock mode needs 6 or 7 players.' };
    }
  }
  return { valid: true };
}

/** Checks that a game can be completed: every score field is filled in. */
export interface CompletenessResult {
  valid: boolean;
  error?: string;
  /** Fields that need attention: player index + raw score key. */
  fields: { player: number; key: string }[];
}

export function checkComplete(
  profile: ScoringProfile,
  players: { name: string; scores: ScoreMap }[],
): CompletenessResult {
  const keys = fieldKeys(profile);
  const fields: { player: number; key: string }[] = [];
  players.forEach((player, playerIndex) => {
    for (const key of keys) {
      if (typeof player.scores[key] !== 'number') {
        fields.push({ player: playerIndex, key });
      }
    }
  });
  if (fields.length > 0) {
    const labels = fields
      .slice(0, 4)
      .map((field) => `${players[field.player]?.name ?? '?'}: ${fieldLabel(profile, field.key)}`);
    const more = fields.length > 4 ? ` (+${fields.length - 4} more)` : '';
    return {
      valid: false,
      error: `Fill in every score before completing. Missing — ${labels.join(', ')}${more}.`,
      fields,
    };
  }

  return { valid: true, fields: [] };
}

function fieldLabel(profile: ScoringProfile, key: string): string {
  if (key.startsWith('nectar_')) {
    const habitat = key.slice('nectar_'.length);
    return (
      profile.categories
        .find((category) => category.kind === 'nectar')
        ?.habitats?.find((item) => item.id === habitat)?.label ?? key
    );
  }
  if (key.startsWith('goalR')) return `Round ${key.slice('goalR'.length)} goal`;
  return profile.categories.find((category) => category.id === key)?.label ?? key;
}

/* ------------------------------------------------------------------ */
/* Raw input keys                                                      */
/* ------------------------------------------------------------------ */

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
    } else if (category.kind === 'roundGoals') {
      for (let round = 1; round <= GOAL_ROUNDS; round += 1) keys.push(goalRoundKey(round));
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

/* ------------------------------------------------------------------ */
/* Computation                                                         */
/* ------------------------------------------------------------------ */

/** Per-player points for one green end-of-round goal, applying tie splitting. */
export function computeGoalRoundPoints(placements: number[], round: number): number[] {
  const table = ROUND_GOAL_POINTS[round - 1] ?? [];
  const points = placements.map(() => 0);
  const groups = new Map<number, number[]>();
  placements.forEach((place, index) => {
    if (place >= 1 && place <= 3) {
      const members = groups.get(place) ?? [];
      members.push(index);
      groups.set(place, members);
    }
  });
  for (const [place, members] of groups) {
    // Tied players occupy the tied place plus the next place(s), and share the
    // combined points, rounded down.
    let available = 0;
    for (let slot = place; slot < place + members.length; slot += 1) {
      available += table[slot - 1] ?? 0;
    }
    const each = Math.floor(available / members.length);
    members.forEach((index) => {
      points[index] = each;
    });
  }
  return points;
}

export interface ComputedGame {
  profile: ScoringProfile;
  perPlayer: Record<string, number>[];
  totals: number[];
  winners: number[];
}

/**
 * Compute per-player category points and totals.
 *
 * Nectar majority and green end-of-round goal ties are cross-player
 * calculations, so this always operates on the full set of players in a game.
 */
export function computeGame(
  profile: ScoringProfile,
  players: { scores: ScoreMap }[],
): ComputedGame {
  const perPlayer: Record<string, number>[] = players.map(() => ({}));

  // Plain counters and signed counters.
  for (const category of profile.categories) {
    if (category.kind === 'nectar' || category.kind === 'roundGoals') continue;
    const perUnit = category.perUnit ?? 1;
    players.forEach((player, index) => {
      const value = toNumber(player.scores[category.id]);
      perPlayer[index][category.id] =
        category.kind === 'signed' ? Math.round(value) : value * perUnit;
    });
  }

  // End-of-round goals.
  const roundGoals = profile.categories.find((category) => category.kind === 'roundGoals');
  if (roundGoals) {
    players.forEach((_, index) => {
      perPlayer[index][roundGoals.id] = 0;
    });

    for (let round = 1; round <= GOAL_ROUNDS; round += 1) {
      const key = goalRoundKey(round);
      const { points } = computeGoalRound(
        profile.goalBoard,
        round,
        players.map((player) => player.scores[key]),
      );
      points.forEach((value, index) => {
        perPlayer[index][roundGoals.id] += value;
      });
    }
  }

  // Nectar majority.
  const nectarCategory = profile.categories.find((category) => category.kind === 'nectar');
  const friendlyTies = (profile.nectarTies ?? 'split') === 'friendly';
  if (nectarCategory?.habitats) {
    players.forEach((_, index) => {
      perPlayer[index][nectarCategory.id] = 0;
    });

    for (const habitat of nectarCategory.habitats) {
      const key = nectarKey(habitat.id);
      const counts = players.map((player) => toNumber(player.scores[key]));
      const ranked = [...new Set(counts.filter((n) => n > 0))].sort((a, b) => b - a);
      let position = 0;

      for (const count of ranked) {
        const groupSize = counts.filter((value) => value === count).length;
        let points: number;
        if (friendlyTies) {
          points = NECTAR_AWARDS[position] ?? 0;
          position += 1;
        } else {
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
export function computePlayerPoints(profile: ScoringProfile, scores: ScoreMap): Record<string, number> {
  const { perPlayer } = computeGame(profile, [{ scores }]);
  return perPlayer[0] ?? {};
}

export function emptyScores(profile: ScoringProfile): ScoreMap {
  const scores: ScoreMap = {};
  // Everything defaults to 0 (counts, goal items, nectar, tie-break).
  for (const key of fieldKeys(profile)) scores[key] = 0;
  scores[TIEBREAK_KEY] = 0;
  return scores;
}
