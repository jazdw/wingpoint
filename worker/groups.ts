import { Hono } from 'hono';
import { requireAuth } from './auth';
import type { AppEnv, Env } from './env';

export interface GroupRow {
  id: string;
  name: string;
  owner_id: string;
  created_at: number;
}

interface MemberJoinRow {
  group_id: string;
  user_id: string;
  role: string;
  name: string;
  email: string;
  picture: string | null;
}

export interface Group {
  id: string;
  name: string;
  ownerId: string;
  createdAt: number;
  members: {
    userId: string;
    name: string;
    email: string;
    picture: string | null;
    role: string;
  }[];
}

export async function isGroupMember(env: Env, groupId: string, userId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    'SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?',
  )
    .bind(groupId, userId)
    .first();
  return Boolean(row);
}

async function loadMembers(env: Env, groupIds: string[]): Promise<Map<string, Group['members']>> {
  const map = new Map<string, Group['members']>();
  if (groupIds.length === 0) return map;

  const placeholders = groupIds.map(() => '?').join(', ');
  const rows = await env.DB.prepare(
    `SELECT m.group_id, m.user_id, m.role, u.name, u.email, u.picture
       FROM group_members m
       JOIN users u ON u.id = m.user_id
      WHERE m.group_id IN (${placeholders})
      ORDER BY u.name COLLATE NOCASE ASC`,
  )
    .bind(...groupIds)
    .all<MemberJoinRow>();

  for (const row of rows.results) {
    const members = map.get(row.group_id) ?? [];
    members.push({
      userId: row.user_id,
      name: row.name,
      email: row.email,
      picture: row.picture,
      role: row.role,
    });
    map.set(row.group_id, members);
  }
  return map;
}

function serialize(row: GroupRow, members: Group['members']): Group {
  return {
    id: row.id,
    name: row.name,
    ownerId: row.owner_id,
    createdAt: row.created_at,
    members,
  };
}

export const groupRoutes = new Hono<AppEnv>();

groupRoutes.use('*', requireAuth);

groupRoutes.get('/', async (c) => {
  const user = c.get('user');
  const rows = await c.env.DB.prepare(
    `SELECT g.* FROM groups g
       JOIN group_members m ON m.group_id = g.id
      WHERE m.user_id = ?
      ORDER BY g.name COLLATE NOCASE ASC`,
  )
    .bind(user.id)
    .all<GroupRow>();

  const members = await loadMembers(c.env, rows.results.map((row) => row.id));
  return c.json({ groups: rows.results.map((row) => serialize(row, members.get(row.id) ?? [])) });
});

groupRoutes.post('/', async (c) => {
  const user = c.get('user');
  const body = (await c.req.json().catch(() => null)) as
    | { name?: unknown; memberIds?: unknown }
    | null;
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 60) : '';
  if (!name) return c.json({ error: 'A group needs a name.' }, 400);

  const id = crypto.randomUUID();
  const now = Date.now();
  const requested = Array.isArray(body?.memberIds)
    ? body.memberIds.filter((value): value is string => typeof value === 'string')
    : [];

  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO groups (id, name, owner_id, created_at) VALUES (?, ?, ?, ?)').bind(
      id,
      name,
      user.id,
      now,
    ),
    c.env.DB.prepare(
      'INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)',
    ).bind(id, user.id, 'owner', now),
    ...requested
      .filter((memberId) => memberId !== user.id)
      .map((memberId) =>
        c.env.DB.prepare(
          'INSERT OR IGNORE INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)',
        ).bind(id, memberId, 'member', now),
      ),
  ]);

  const row = await c.env.DB.prepare('SELECT * FROM groups WHERE id = ?').bind(id).first<GroupRow>();
  const members = await loadMembers(c.env, [id]);
  return c.json({ group: serialize(row!, members.get(id) ?? []) }, 201);
});

groupRoutes.patch('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT * FROM groups WHERE id = ?').bind(id).first<GroupRow>();
  if (!row) return c.json({ error: 'Group not found.' }, 404);
  if (row.owner_id !== user.id) return c.json({ error: 'Only the group owner can edit it.' }, 403);

  const body = (await c.req.json().catch(() => null)) as { name?: unknown } | null;
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 60) : '';
  if (!name) return c.json({ error: 'A group needs a name.' }, 400);

  await c.env.DB.prepare('UPDATE groups SET name = ? WHERE id = ?').bind(name, id).run();
  const updated = await c.env.DB.prepare('SELECT * FROM groups WHERE id = ?').bind(id).first<GroupRow>();
  const members = await loadMembers(c.env, [id]);
  return c.json({ group: serialize(updated!, members.get(id) ?? []) });
});

groupRoutes.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT * FROM groups WHERE id = ?').bind(id).first<GroupRow>();
  if (!row) return c.json({ error: 'Group not found.' }, 404);
  if (row.owner_id !== user.id) return c.json({ error: 'Only the group owner can delete it.' }, 403);
  await c.env.DB.prepare('DELETE FROM groups WHERE id = ?').bind(id).run();
  return c.json({ ok: true });
});

groupRoutes.post('/:id/members', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const row = await c.env.DB.prepare('SELECT * FROM groups WHERE id = ?').bind(id).first<GroupRow>();
  if (!row) return c.json({ error: 'Group not found.' }, 404);
  if (row.owner_id !== user.id) return c.json({ error: 'Only the group owner can add members.' }, 403);

  const body = (await c.req.json().catch(() => null)) as { userId?: unknown } | null;
  const memberId = typeof body?.userId === 'string' ? body.userId : '';
  if (!memberId) return c.json({ error: 'A user is required.' }, 400);

  await c.env.DB.prepare(
    'INSERT OR IGNORE INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)',
  )
    .bind(id, memberId, 'member', Date.now())
    .run();

  const members = await loadMembers(c.env, [id]);
  return c.json({ group: serialize(row, members.get(id) ?? []) });
});

groupRoutes.delete('/:id/members/:userId', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const memberId = c.req.param('userId');
  const row = await c.env.DB.prepare('SELECT * FROM groups WHERE id = ?').bind(id).first<GroupRow>();
  if (!row) return c.json({ error: 'Group not found.' }, 404);
  if (row.owner_id !== user.id) return c.json({ error: 'Only the group owner can remove members.' }, 403);
  if (memberId === row.owner_id) return c.json({ error: 'The group owner cannot be removed.' }, 400);

  await c.env.DB.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?')
    .bind(id, memberId)
    .run();

  const members = await loadMembers(c.env, [id]);
  return c.json({ group: serialize(row, members.get(id) ?? []) });
});
