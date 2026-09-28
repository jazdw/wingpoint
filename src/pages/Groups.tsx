import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { useAuth } from '../auth';
import type { Group, PublicUser } from '../../shared/types';

function GroupCard({
  group,
  users,
  currentUserId,
}: {
  group: Group;
  users: PublicUser[];
  currentUserId: string;
}) {
  const queryClient = useQueryClient();
  const [addUserId, setAddUserId] = useState('');
  const isOwner = group.ownerId === currentUserId;
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['groups'] });

  const addMember = useMutation({
    mutationFn: (userId: string) =>
      api(`/api/groups/${group.id}/members`, {
        method: 'POST',
        body: JSON.stringify({ userId }),
      }),
    onSuccess: () => {
      setAddUserId('');
      invalidate();
    },
  });
  const removeMember = useMutation({
    mutationFn: (userId: string) =>
      api(`/api/groups/${group.id}/members/${userId}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });
  const removeGroup = useMutation({
    mutationFn: () => api(`/api/groups/${group.id}`, { method: 'DELETE' }),
    onSuccess: invalidate,
  });

  const memberIds = new Set(group.members.map((member) => member.userId));
  const candidates = users.filter((candidate) => !memberIds.has(candidate.id));

  return (
    <div className="card stack-sm">
      <div className="section-head">
        <div>
          <h3>{group.name}</h3>
          <p className="muted">
            {group.members.length} member{group.members.length === 1 ? '' : 's'}
          </p>
        </div>
        {isOwner && (
          <button
            type="button"
            className="btn btn-danger btn-sm"
            onClick={() => {
              if (window.confirm(`Delete the group “${group.name}”? Games will become private.`)) {
                removeGroup.mutate();
              }
            }}
          >
            Delete
          </button>
        )}
      </div>

      <ul className="member-list">
        {group.members.map((member) => (
          <li key={member.userId}>
            <span className="member-name">
              {member.picture ? (
                <img className="avatar avatar-sm" src={member.picture} alt="" referrerPolicy="no-referrer" />
              ) : (
                <span className="avatar avatar-sm avatar-fallback">
                  {member.name[0]?.toUpperCase() ?? '?'}
                </span>
              )}
              {member.name}
              {member.role === 'owner' && <span className="badge">owner</span>}
            </span>
            {isOwner && member.userId !== group.ownerId && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => removeMember.mutate(member.userId)}
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>

      {isOwner && candidates.length > 0 && (
        <div className="player-row">
          <select value={addUserId} onChange={(event) => setAddUserId(event.target.value)}>
            <option value="">Add a member…</option>
            {candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="btn btn-sm"
            disabled={!addUserId || addMember.isPending}
            onClick={() => addUserId && addMember.mutate(addUserId)}
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}

export function GroupsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const groupsQuery = useQuery({
    queryKey: ['groups'],
    queryFn: () => api<{ groups: Group[] }>('/api/groups'),
  });
  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: () => api<{ users: PublicUser[] }>('/api/users'),
  });

  const createGroup = useMutation({
    mutationFn: (body: { name: string; memberIds: string[] }) =>
      api<{ group: Group }>('/api/groups', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      setName('');
      setSelectedMemberIds([]);
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['groups'] });
    },
    onError: (mutationError: Error) => setError(mutationError.message),
  });

  const groups = groupsQuery.data?.groups ?? [];
  const users = usersQuery.data?.users ?? [];
  const others = users.filter((candidate) => candidate.id !== user?.id);

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Groups</h1>
          <p className="muted">
            Group the people you play with. Everyone in a group can see the group’s games and watch
            them being scored live, but only the score master can edit.
          </p>
        </div>
      </div>

      <div className="card stack-sm">
        <h2>New group</h2>
        <label className="field">
          <span>Group name</span>
          <input
            value={name}
            placeholder="e.g. Tuesday game night"
            onChange={(event) => setName(event.target.value.slice(0, 60))}
          />
        </label>
        {others.length > 0 && (
          <div className="field">
            <span>Initial members</span>
            <div className="chip-list">
              {others.map((candidate) => {
                const selected = selectedMemberIds.includes(candidate.id);
                return (
                  <button
                    key={candidate.id}
                    type="button"
                    className={`chip${selected ? ' chip-on' : ''}`}
                    onClick={() =>
                      setSelectedMemberIds((prev) =>
                        selected ? prev.filter((id) => id !== candidate.id) : [...prev, candidate.id],
                      )
                    }
                  >
                    {candidate.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {error && <p className="alert alert-error">{error}</p>}
        <div className="actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!name.trim() || createGroup.isPending}
            onClick={() => createGroup.mutate({ name: name.trim(), memberIds: selectedMemberIds })}
          >
            {createGroup.isPending ? 'Creating…' : 'Create group'}
          </button>
        </div>
      </div>

      {groupsQuery.isLoading && <p className="muted">Loading groups…</p>}
      {!groupsQuery.isLoading && groups.length === 0 && (
        <div className="card empty-state">
          <p className="muted">You’re not in any groups yet.</p>
        </div>
      )}
      <div className="two-col">
        {groups.map((group) => (
          <GroupCard key={group.id} group={group} users={users} currentUserId={user?.id ?? ''} />
        ))}
      </div>
    </div>
  );
}
