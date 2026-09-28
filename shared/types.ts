/**
 * Types shared between the Cloudflare Worker and the React frontend.
 * Keep this file free of any DOM / Workers specific APIs.
 */

export type GameMode = 'competitive' | 'solo' | 'coop';
export type GameStatus = 'in_progress' | 'completed';
export type GoalBoard = 'green' | 'blue';
export type AsiaVariant = 'none' | 'duet' | 'flock';
export type PlayerStatus = 'pending' | 'accepted';

/** Raw scores keyed by score field id (see shared/scoring.ts). */
export type ScoreMap = Record<string, number | null>;

export interface GameConfig {
  /** Expansion ids mixed with the base game (see EXPANSIONS). */
  expansions: string[];
  goalBoard: GoalBoard;
  asiaVariant: AsiaVariant;
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
  groupId: string | null;
  playedAt: number;
  mode: GameMode;
  status: GameStatus;
  expansions: string[];
  goalBoard: GoalBoard;
  asiaVariant: AsiaVariant;
  notes: string | null;
  players: GamePlayer[];
  createdAt: number;
  updatedAt: number;
}

/** A lightweight game representation used by list views. */
export interface GameSummary {
  id: string;
  ownerId: string;
  groupId: string | null;
  playedAt: number;
  mode: GameMode;
  status: GameStatus;
  expansions: string[];
  goalBoard: GoalBoard;
  asiaVariant: AsiaVariant;
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

export interface GroupMember {
  userId: string;
  name: string;
  email: string;
  picture: string | null;
  role: string;
}

export interface Group {
  id: string;
  name: string;
  ownerId: string;
  createdAt: number;
  members: GroupMember[];
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
  scope: 'me' | 'group';
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
