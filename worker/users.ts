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

userRoutes.get('/', async (c) => {
  const rows = await c.env.DB.prepare(
    'SELECT id, name, email, picture FROM users ORDER BY name COLLATE NOCASE ASC',
  ).all<PublicUserRow>();
  const users: PublicUser[] = rows.results;
  return c.json({ users });
});
