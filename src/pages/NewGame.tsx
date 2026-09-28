import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { DEFAULT_PROFILE_ID, PROFILES } from '../../shared/scoring';
import type { Game, GameMode, Group, PublicUser } from '../../shared/types';
import { fromDateInput, toDateInput } from '../lib/format';

interface DraftPlayer {
  id: string;
  name: string;
  userId: string | null;
}

export function NewGame() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: () => api<{ users: PublicUser[] }>('/api/users'),
  });
  const groupsQuery = useQuery({
    queryKey: ['groups'],
    queryFn: () => api<{ groups: Group[] }>('/api/groups'),
  });

  const [groupId, setGroupId] = useState('');
  const [playedAt, setPlayedAt] = useState(() => Date.now());
  const [mode, setMode] = useState<GameMode>('competitive');
  const [profileId, setProfileId] = useState(DEFAULT_PROFILE_ID);
  const [players, setPlayers] = useState<DraftPlayer[]>([
    { id: crypto.randomUUID(), name: user?.name ?? 'Player 1', userId: user?.id ?? null },
  ]);
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (body: unknown) =>
      api<{ game: Game }>('/api/games', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['games'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      navigate(`/games/${result.game.id}`);
    },
    onError: (mutationError: Error) => setError(mutationError.message),
  });

  function chooseGroup(nextGroupId: string) {
    setGroupId(nextGroupId);
    const group = (groupsQuery.data?.groups ?? []).find((item) => item.id === nextGroupId);
    if (group) {
      setPlayers(
        group.members.map((member) => ({
          id: crypto.randomUUID(),
          name: member.name,
          userId: member.userId,
        })),
      );
    } else {
      setPlayers([
        { id: crypto.randomUUID(), name: user?.name ?? 'Player 1', userId: user?.id ?? null },
      ]);
    }
  }

  function updatePlayer(index: number, partial: Partial<DraftPlayer>) {
    setPlayers((prev) => prev.map((player, i) => (i === index ? { ...player, ...partial } : player)));
  }

  function addPlayer() {
    setPlayers((prev) => [
      ...prev,
      { id: crypto.randomUUID(), name: `Player ${prev.length + 1}`, userId: null },
    ]);
  }

  function removePlayer(index: number) {
    setPlayers((prev) => prev.filter((_, i) => i !== index));
  }

  function submit() {
    setError(null);
    const cleanPlayers = players
      .map((player) => ({ ...player, name: player.name.trim() }))
      .filter((player) => player.name.length > 0);
    if (cleanPlayers.length === 0) {
      setError('Add at least one player.');
      return;
    }
    create.mutate({
      playedAt,
      mode,
      scoringProfile: profileId,
      groupId: groupId || null,
      players: cleanPlayers,
    });
  }

  const users = usersQuery.data?.users ?? [];

  return (
    <div className="stack narrow">
      <div className="page-head">
        <div>
          <h1>New game</h1>
          <p className="muted">Set up the table, then start entering scores.</p>
        </div>
        <Link to="/" className="btn btn-ghost">
          Cancel
        </Link>
      </div>

      <div className="card stack-sm">
        <div className="field-row">
          <label className="field">
            <span>Date</span>
            <input
              type="date"
              value={toDateInput(playedAt)}
              onChange={(event) => setPlayedAt(fromDateInput(event.target.value))}
            />
          </label>
          <label className="field">
            <span>Mode</span>
            <select value={mode} onChange={(event) => setMode(event.target.value as GameMode)}>
              <option value="competitive">Competitive</option>
              <option value="solo">Solo</option>
              <option value="coop">Co-op</option>
            </select>
          </label>
        </div>

        <label className="field">
          <span>Scoring / expansions</span>
          <select value={profileId} onChange={(event) => setProfileId(event.target.value)}>
            {PROFILES.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
          <small className="muted">
            {PROFILES.find((profile) => profile.id === profileId)?.description}
          </small>
        </label>

        {(groupsQuery.data?.groups.length ?? 0) > 0 && (
          <label className="field">
            <span>Group (optional)</span>
            <select value={groupId} onChange={(event) => chooseGroup(event.target.value)}>
              <option value="">Private — only me</option>
              {(groupsQuery.data?.groups ?? []).map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
            <small className="muted">
              Group members can watch this game live, but only you can edit it.
            </small>
          </label>
        )}
      </div>

      <div className="card stack-sm">
        <div className="section-head">
          <h2>Players</h2>
          <button type="button" className="btn btn-sm" onClick={addPlayer} disabled={players.length >= 8}>
            Add player
          </button>
        </div>

        {players.map((player, index) => (
          <div className="player-row" key={player.id}>
            <input
              className="player-row-name"
              value={player.name}
              placeholder={`Player ${index + 1}`}
              aria-label={`Player ${index + 1} name`}
              onChange={(event) => updatePlayer(index, { name: event.target.value.slice(0, 40) })}
              onFocus={(event) => event.currentTarget.select()}
            />
            <select
              aria-label={`Account for ${player.name}`}
              value={player.userId ?? ''}
              onChange={(event) => updatePlayer(index, { userId: event.target.value || null })}
            >
              <option value="">Guest</option>
              {users.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => removePlayer(index)}
              disabled={players.length <= 1}
            >
              Remove
            </button>
          </div>
        ))}
        <p className="fine-print">
          Linking a player to an account lets WingPoint attribute personal stats. Players without an
          account are tracked by name.
        </p>
      </div>

      {error && <p className="alert alert-error">{error}</p>}

      <div className="actions">
        <button
          type="button"
          className="btn btn-primary btn-block"
          onClick={submit}
          disabled={create.isPending}
        >
          {create.isPending ? 'Creating…' : 'Start game'}
        </button>
      </div>
    </div>
  );
}
