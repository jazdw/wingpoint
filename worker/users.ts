import { Hono } from 'hono';
import type { PublicUser } from '../shared/types';
import { requireAuth } from './auth';
import type { AppEnv } from './env';

interface PublicUserRow {
  id: string;
  name: string;
  email: string;
  picture: string | null;
}

export const userRoutes = new Hono<AppEnv>();

userRoutes.use('*', requireAuth);

/**
 * People you have actually played a game with. New players are added by email
 * (see `/lookup`); the dropdown is only for convenience.
 */
userRoutes.get('/', async (c) => {
  const user = c.get('user');
  const rows = await c.env.DB.prepare(
    `SELECT DISTINCT u.id, u.name, u.email, u.picture
       FROM users u
       JOIN game_players gp ON gp.user_id = u.id
      WHERE u.id != ?
        AND gp.game_id IN (
          SELECT game_id FROM game_players WHERE user_id = ? AND status = 'accepted'
        )
      ORDER BY u.name COLLATE NOCASE ASC`,
  )
    .bind(user.id, user.id)
    .all<PublicUserRow>();
  const users: PublicUser[] = rows.results;
  return c.json({ users });
});

/** Look up an allow-listed account by email so you can invite them. */
userRoutes.get('/lookup', async (c) => {
  const email = c.req.query('email')?.trim().toLowerCase();
  if (!email) return c.json({ error: 'Enter an email address.' }, 400);

  const row = await c.env.DB.prepare(
    'SELECT id, name, email, picture FROM users WHERE lower(email) = ?',
  )
    .bind(email)
    .first<PublicUserRow>();

  if (!row) return c.json({ error: 'No WingPoint account with that email address.' }, 404);
  return c.json({ user: row });
});
