import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { Context, MiddlewareHandler } from 'hono';
import type { AuthUser } from '../shared/types';
import { type AppEnv, type Env, type UserRow } from './env';

export const SESSION_COOKIE = 'wp_session';
const OAUTH_STATE_COOKIE = 'wp_oauth_state';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

/* ------------------------------------------------------------------ */
/* Token helpers                                                       */
/* ------------------------------------------------------------------ */

function randomToken(bytes = 32): string {
  const buffer = new Uint8Array(bytes);
  crypto.getRandomValues(buffer);
  return [...buffer].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function isSecureRequest(url: string): boolean {
  return new URL(url).protocol === 'https:';
}

/**
 * Whether a host is local or on a private network. Used only to gate the
 * development sign-in so it works from a phone on the same LAN but never on a
 * public hostname.
 */
function isPrivateHost(host: string): boolean {
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
  if (host.endsWith('.local')) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(host)) return true;
  return false;
}

function toAuthUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    picture: row.picture,
    createdAt: row.created_at,
  };
}

/* ------------------------------------------------------------------ */
/* Session storage                                                     */
/* ------------------------------------------------------------------ */

export async function createSession(env: Env, userId: string): Promise<string> {
  const token = randomToken();
  const tokenHash = await sha256Hex(token);
  const now = Date.now();
  await env.DB.prepare(
    'INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
  )
    .bind(tokenHash, userId, now, now + SESSION_TTL_SECONDS * 1000)
    .run();
  return token;
}

export async function destroySession(env: Env, token: string): Promise<void> {
  const tokenHash = await sha256Hex(token);
  await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(tokenHash).run();
}

async function getUserFromToken(env: Env, token: string): Promise<AuthUser | null> {
  const tokenHash = await sha256Hex(token);
  const row = await env.DB.prepare(
    `SELECT u.* FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.id = ? AND s.expires_at > ?`,
  )
    .bind(tokenHash, Date.now())
    .first<UserRow>();
  return row ? toAuthUser(row) : null;
}

function setSessionCookie(c: Context<AppEnv>, token: string): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: isSecureRequest(c.req.url),
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

/* ------------------------------------------------------------------ */
/* Whitelist                                                           */
/* ------------------------------------------------------------------ */

export async function isEmailAllowed(env: Env, email: string): Promise<boolean> {
  const normalized = email.trim().toLowerCase();
  const configured = (env.ALLOWED_EMAILS ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if (configured.includes(normalized)) return true;

  const row = await env.DB.prepare('SELECT email FROM allowed_emails WHERE lower(email) = ?')
    .bind(normalized)
    .first<{ email: string }>();
  return Boolean(row);
}

/* ------------------------------------------------------------------ */
/* Users                                                               */
/* ------------------------------------------------------------------ */

interface UserProfile {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
}

async function upsertUser(env: Env, profile: UserProfile): Promise<string> {
  const now = Date.now();
  const existing = await env.DB.prepare('SELECT * FROM users WHERE google_sub = ?')
    .bind(profile.sub)
    .first<UserRow>();
  const name = profile.name ?? profile.email;
  const picture = profile.picture ?? null;

  if (existing) {
    await env.DB.prepare(
      'UPDATE users SET email = ?, name = ?, picture = ?, last_login_at = ? WHERE id = ?',
    )
      .bind(profile.email, name, picture, now, existing.id)
      .run();
    return existing.id;
  }

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO users (id, google_sub, email, name, picture, created_at, last_login_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, profile.sub, profile.email, name, picture, now, now)
    .run();
  return id;
}

/* ------------------------------------------------------------------ */
/* Middleware                                                          */
/* ------------------------------------------------------------------ */

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return c.json({ error: 'unauthenticated' }, 401);

  const user = await getUserFromToken(c.env, token);
  if (!user) {
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
    return c.json({ error: 'unauthenticated' }, 401);
  }

  c.set('user', user);
  await next();
};

/* ------------------------------------------------------------------ */
/* Routes                                                              */
/* ------------------------------------------------------------------ */

export const authRoutes = new Hono<AppEnv>();

authRoutes.get('/google', async (c) => {
  const { GOOGLE_CLIENT_ID } = c.env;
  if (!GOOGLE_CLIENT_ID) {
    return c.json({ error: 'Google OAuth is not configured (GOOGLE_CLIENT_ID missing).' }, 500);
  }

  const state = randomToken(16);
  setCookie(c, OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: isSecureRequest(c.req.url),
    path: '/',
    maxAge: 600,
  });

  const redirectUri = `${new URL(c.req.url).origin}/api/auth/google/callback`;
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'online',
    prompt: 'select_account',
    state,
  });

  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

authRoutes.get('/google/callback', async (c) => {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = c.env;
  const url = new URL(c.req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const expectedState = getCookie(c, OAUTH_STATE_COOKIE);
  deleteCookie(c, OAUTH_STATE_COOKIE, { path: '/' });

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return c.redirect('/?auth=config_error');
  }
  if (!code || !state || !expectedState || state !== expectedState) {
    return c.redirect('/?auth=invalid_state');
  }

  try {
    const redirectUri = `${url.origin}/api/auth/google/callback`;
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenResponse.ok) return c.redirect('/?auth=token_error');
    const tokens = (await tokenResponse.json()) as { access_token?: string };
    if (!tokens.access_token) return c.redirect('/?auth=token_error');

    const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    if (!profileResponse.ok) return c.redirect('/?auth=profile_error');

    const profile = (await profileResponse.json()) as {
      sub?: string;
      email?: string;
      email_verified?: boolean;
      name?: string;
      picture?: string;
    };

    if (!profile.sub || !profile.email) return c.redirect('/?auth=profile_error');
    if (profile.email_verified === false) return c.redirect('/?auth=email_unverified');
    if (!(await isEmailAllowed(c.env, profile.email))) {
      return c.redirect('/?auth=not_allowed');
    }

    const userId = await upsertUser(c.env, {
      sub: profile.sub,
      email: profile.email,
      name: profile.name,
      picture: profile.picture,
    });
    const token = await createSession(c.env, userId);
    setSessionCookie(c, token);
    return c.redirect('/');
  } catch (error) {
    console.error('OAuth callback failed', error);
    return c.redirect('/?auth=oauth_failed');
  }
});

authRoutes.get('/me', requireAuth, (c) => {
  return c.json({ user: c.get('user') });
});

authRoutes.post('/logout', async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await destroySession(c.env, token);
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});

function devEmails(env: Env): string[] {
  const raw = env.DEV_LOGIN_EMAILS ?? env.DEV_LOGIN_EMAIL ?? '';
  return raw
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

function devDisplayName(email: string): string {
  const local = email.split('@')[0] ?? email;
  return local.charAt(0).toUpperCase() + local.slice(1);
}

/** The dev accounts available to sign in as (only on a local/private host). */
authRoutes.get('/dev-users', (c) => {
  const host = new URL(c.req.url).hostname;
  if (!isPrivateHost(host)) return c.json({ users: [] });
  return c.json({
    users: devEmails(c.env).map((email) => ({ email, name: devDisplayName(email) })),
  });
});

/**
 * Local-development sign-in. Only works for an allow-listed dev email and when
 * the request is made to a local/private host, so it can never be used in
 * production.
 */
authRoutes.get('/dev', async (c) => {
  const host = new URL(c.req.url).hostname;
  const allowed = devEmails(c.env);
  const requested = c.req.query('email')?.trim().toLowerCase();
  const email = requested ?? allowed[0];
  if (!email || !isPrivateHost(host) || !allowed.includes(email)) {
    return c.json({ error: 'Dev sign-in is disabled.' }, 403);
  }

  const userId = await upsertUser(c.env, {
    sub: `dev:${email}`,
    email,
    name: devDisplayName(email),
  });
  const token = await createSession(c.env, userId);
  setSessionCookie(c, token);
  return c.redirect('/');
});
