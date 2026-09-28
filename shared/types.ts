/**
 * Types shared between the Cloudflare Worker and the React frontend.
 * Keep this file free of any DOM / Workers specific APIs.
 */

export type GameStatus = 'in_progress' | 'completed';
export type GoalBoard = 'green' | 'blue';
/** Standalone sets. Wingspan base and/or Wingspan Asia. */
export type CoreSet = 'wingspan' | 'asia';
/** Wingspan Asia play modes. Duet needs 2 players, Flock needs 6–7. */
export type PlayMode = 'standard' | 'duet' | 'flock';
export type PlayerStatus = 'pending' | 'accepted';

/** Raw scores keyed by score field id (see shared/scoring.ts). */
export type ScoreMap = Record<string, number | null>;

export interface GameConfig {
  /** Standalone sets in play, at least one of `wingspan` / `asia`. */
  coreSets: CoreSet[];
  /** Expansion ids mixed in (European, Oceania, Americas). */
  expansions: string[];
  goalBoard: GoalBoard;
  playMode: PlayMode;
}

export interface GamePlayer {
  id: string;
  name: string;
  userId: string | null;
  seat?: number;
  status: PlayerStatus;
  scores: ScoreMap;
}

export interface Game {
  id: string;
  ownerId: string;
  playedAt: number;
  status: GameStatus;
  coreSets: CoreSet[];
  expansions: string[];
  goalBoard: GoalBoard;
  playMode: PlayMode;
  notes: string | null;
  players: GamePlayer[];
  createdAt: number;
  updatedAt: number;
}

/** A lightweight game representation used by list views. */
export interface GameSummary {
  id: string;
  ownerId: string;
  playedAt: number;
  status: GameStatus;
  coreSets: CoreSet[];
  expansions: string[];
  goalBoard: GoalBoard;
  playMode: PlayMode;
  scored: boolean;
  players: {
    id: string;
    name: string;
    userId: string | null;
    status: PlayerStatus;
    total: number;
  }[];
  winners: string[];
  createdAt: number;
  updatedAt: number;
}

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  picture: string | null;
}

export interface RankingBucket {
  games: number;
  wins: number;
  averageScore: number;
  bestScore: number;
  lowestScore: number;
}

export interface RivalStat {
  name: string;
  userId: string | null;
  gamesTogether: number;
  myWins: number;
  theirWins: number;
  myAverage: number;
  theirAverage: number;
}

export interface Stats {
  /** The player these stats are for. */
  subject: { id: string; name: string; picture: string | null } | null;
  totals: {
    games: number;
    completed: number;
    wins: number;
    winRate: number;
    averageScore: number;
    bestScore: number;
  };
  categoryAverages: { id: string; label: string; average: number }[];
  byPlayerCount: { playerCount: number; games: number; averageScore: number }[];
  byProfile: { profile: string; name: string; games: number; averageScore: number }[];
  rivals: RivalStat[];
  recent: GameSummary[];
}

export interface AuthUser extends PublicUser {
  createdAt: number;
}
