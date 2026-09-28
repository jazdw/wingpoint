/**
 * Types shared between the Cloudflare Worker and the React frontend.
 * Keep this file free of any DOM / Workers specific APIs.
 */

export type GameMode = 'competitive' | 'solo' | 'coop';
export type GameStatus = 'in_progress' | 'completed';

/** Raw scores keyed by score field id (see shared/scoring.ts). */
export type ScoreMap = Record<string, number | null>;

export interface GamePlayer {
  id: string;
  name: string;
  userId: string | null;
  seat?: number;
  scores: ScoreMap;
}

export interface Game {
  id: string;
  ownerId: string;
  groupId: string | null;
  playedAt: number;
  mode: GameMode;
  status: GameStatus;
  scoringProfile: string;
  expansions: string[];
  notes: string | null;
  players: GamePlayer[];
  createdAt: number;
  updatedAt: number;
}

/** A lightweight game representation used by list views. */
export interface GameSummary {
  id: string;
  groupId: string | null;
  playedAt: number;
  mode: GameMode;
  status: GameStatus;
  scoringProfile: string;
  expansions: string[];
  scored: boolean;
  players: {
    id: string;
    name: string;
    userId: string | null;
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

export interface StatsBucket {
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
