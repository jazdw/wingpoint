import type { AuthUser } from '../shared/types';

export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  /** Comma separated allow-list of Google account emails. */
  ALLOWED_EMAILS?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /**
   * LOCAL DEVELOPMENT ONLY. Comma-separated emails that `GET /api/auth/dev`
   * can sign in as without Google. Ignored on any non-local host.
   */
  DEV_LOGIN_EMAILS?: string;
  /** Single-email fallback for DEV_LOGIN_EMAILS. */
  DEV_LOGIN_EMAIL?: string;
}

export type AppEnv = {
  Bindings: Env;
  Variables: {
    user: AuthUser;
  };
};

export interface UserRow {
  id: string;
  google_sub: string;
  email: string;
  name: string;
  picture: string | null;
  created_at: number;
  last_login_at: number | null;
}
