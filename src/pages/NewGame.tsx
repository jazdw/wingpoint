import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import {
  CORE_SETS,
  deriveProfile,
  normalizeConfig,
  SELECTABLE_EXPANSIONS,
  validateConfig,
} from '../../shared/scoring';
import type { CoreSet, Game, GoalBoard, PublicUser } from '../../shared/types';
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

  const [playedAt, setPlayedAt] = useState(() => Date.now());
  const [coreSets, setCoreSets] = useState<CoreSet[]>(['wingspan']);
  const [expansions, setExpansions] = useState<string[]>([]);
  const [goalBoard, setGoalBoard] = useState<GoalBoard>('green');
  const [players, setPlayers] = useState<DraftPlayer[]>([
    { id: crypto.randomUUID(), name: user?.name ?? 'Player 1', userId: user?.id ?? null },
  ]);
  const [error, setError] = useState<string | null>(null);

  const config = normalizeConfig({ coreSets, expansions, goalBoard });
  const profile = deriveProfile(config);
  const validation = validateConfig(config, players.length);
  const selectedUserIds = new Set(players.map((player) => player.userId).filter(Boolean) as string[]);
  const hasDuplicateUsers = selectedUserIds.size !== players.filter((p) => p.userId).length;

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

  function toggleCoreSet(setId: CoreSet) {
    setCoreSets((prev) =>
      prev.includes(setId) ? prev.filter((value) => value !== setId) : [...prev, setId],
    );
  }

  function toggleExpansion(expansionId: string) {
    setExpansions((prev) =>
      prev.includes(expansionId)
        ? prev.filter((value) => value !== expansionId)
        : [...prev, expansionId],
    );
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
    const accounts = cleanPlayers.map((player) => player.userId).filter(Boolean);
    if (new Set(accounts).size !== accounts.length) {
      setError('Each account can only be added once.');
      return;
    }
    if (!validation.valid) {
      setError(validation.error ?? 'Invalid game setup.');
      return;
    }
    create.mutate({
      playedAt,
      coreSets: config.coreSets,
      expansions: config.expansions,
      goalBoard: config.goalBoard,
      playMode: config.playMode,
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
        <label className="field">
          <span>Date</span>
          <input
            type="date"
            value={toDateInput(playedAt)}
            onChange={(event) => setPlayedAt(fromDateInput(event.target.value))}
          />
        </label>

        <div className="setup-row">
          <span className="setup-label">Standalone sets</span>
          <div className="chip-list">
            {CORE_SETS.map((set) => (
              <button
                key={set.id}
                type="button"
                className={`chip${config.coreSets.includes(set.id as CoreSet) ? ' chip-on' : ''}`}
                onClick={() => toggleCoreSet(set.id as CoreSet)}
              >
                {set.short}
              </button>
            ))}
          </div>
        </div>

        <div className="setup-row">
          <span className="setup-label">Expansions</span>
          <div className="chip-list">
            {SELECTABLE_EXPANSIONS.map((expansion) => (
              <button
                key={expansion.id}
                type="button"
                className={`chip${config.expansions.includes(expansion.id) ? ' chip-on' : ''}`}
                onClick={() => toggleExpansion(expansion.id)}
              >
                {expansion.short}
              </button>
            ))}
          </div>
        </div>

        <div className="setup-row">
          <span className="setup-label">Goal board</span>
          <div className="segmented">
            {(['green', 'blue'] as GoalBoard[]).map((board) => (
              <button
                key={board}
                type="button"
                className={config.goalBoard === board ? 'active' : ''}
                onClick={() => setGoalBoard(board)}
              >
                {board === 'green' ? 'Green (majority)' : 'Blue (per item)'}
              </button>
            ))}
          </div>
        </div>

        {!validation.valid && <p className="alert alert-error">{validation.error}</p>}
        <p className="fine-print">{profile.name}</p>
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
                <option
                  key={account.id}
                  value={account.id}
                  disabled={selectedUserIds.has(account.id) && player.userId !== account.id}
                >
                  {account.name}
                  {selectedUserIds.has(account.id) && player.userId !== account.id ? ' (already added)' : ''}
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
          Linking a player to an account lets WingPoint attribute stats and lets them watch the game
          live. They’ll be invited to accept. Guests are tracked by name.
        </p>
      </div>

      {(error || hasDuplicateUsers) && (
        <p className="alert alert-error">{error ?? 'Each account can only be added once.'}</p>
      )}

      <div className="actions">
        <button
          type="button"
          className="btn btn-primary btn-block"
          onClick={submit}
          disabled={create.isPending || hasDuplicateUsers || !validation.valid}
        >
          {create.isPending ? 'Creating…' : 'Start game'}
        </button>
      </div>
    </div>
  );
}
