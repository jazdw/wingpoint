import { Hono } from 'hono';
import { authRoutes } from './auth';
import type { AppEnv } from './env';
import { gameRoutes } from './games';
import { statsRoutes } from './stats';
import { userRoutes } from './users';

const app = new Hono<AppEnv>();

// Baseline security headers. The Vite dev server serves HTML itself, so these
// mainly apply to API responses and the production Worker.
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
});

app.get('/api/health', (c) => c.json({ ok: true, name: 'wingpoint' }));

app.route('/api/auth', authRoutes);
app.route('/api/users', userRoutes);
app.route('/api/games', gameRoutes);
app.route('/api/stats', statsRoutes);

app.notFound((c) => {
  if (!c.req.path.startsWith('/api/') && c.env.ASSETS) {
    return c.env.ASSETS.fetch(c.req.raw);
  }
  return c.json({ error: 'Not found.' }, 404);
});

app.onError((error, c) => {
  console.error('Unhandled error', error);
  return c.json({ error: 'Internal server error.' }, 500);
});

export default app;
