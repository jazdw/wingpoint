import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth, useOnline } from '../auth';
import { ScoreSheet, type EditablePlayer } from '../components/ScoreSheet';
import {
  deriveProfile,
  emptyScores,
  fieldKeys,
  normalizeConfig,
  SELECTABLE_EXPANSIONS,
  TIEBREAK_KEY,
  validateConfig,
} from '../../shared/scoring';
import type {
  AsiaVariant,
  Game,
  GameConfig,
  GameMode,
  GameStatus,
  GoalBoard,
  Group,
  PublicUser,
  ScoreMap,
} from '../../shared/types';
import { formatDateTime, fromDateInput, toDateInput } from '../lib/format';

type SaveState = 'saved' | 'saving' | 'offline' | 'error';

function gameConfig(game: Game): GameConfig {
  return normalizeConfig({
    expansions: game.expansions,
    goalBoard: game.goalBoard,
    asiaVariant: game.asiaVariant,
  });
}

function toPayload(game: Game) {
  return {
    playedAt: game.playedAt,
    mode: game.mode,
    status: game.status,
    expansions: game.expansions,
    goalBoard: game.goalBoard,
    asiaVariant: game.asiaVariant,
    notes: game.notes,
    players: game.players.map((player) => ({
      id: player.id,
      name: player.name,
      userId: player.userId,
      scores: player.scores,
    })),
  };
}

const SAVE_LABELS: Record<SaveState, string> = {
  saved: 'Saved',
  saving: 'Saving…',
  offline: 'Offline — changes kept on this device',
  error: 'Could not save — will retry',
};

export function GameDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const online = useOnline();
  const { user } = useAuth();
  const draftKey = `wp-draft-${id}`;

  const gameQuery = useQuery({
    queryKey: ['game', id],
    queryFn: () => api<{ game: Game }>(`/api/games/${id}`),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const game = query.state.data?.game;
      if (game && game.ownerId !== user?.id && game.status === 'in_progress') return 5000;
      return false;
    },
  });

  const groupsQuery = useQuery({
    queryKey: ['groups'],
    queryFn: () => api<{ groups: Group[] }>('/api/groups'),
  });
  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: () => api<{ users: PublicUser[] }>('/api/users'),
  });

  const [draft, setDraft] = useState<Game | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const lastSaved = useRef('');
  const initialised = useRef(false);

  const serverGame = gameQuery.data?.game;
  const isOwner = Boolean(serverGame && user && serverGame.ownerId === user.id);
  const readOnly = Boolean(serverGame) && !isOwner;
  const myPlayer = serverGame?.players.find((player) => player.userId === user?.id);
  const isInvited = myPlayer?.status === 'pending';

  useEffect(() => {
    if (!serverGame) return;
    if (!isOwner || !initialised.current) {
      setDraft(serverGame);
      lastSaved.current = JSON.stringify(toPayload(serverGame));
      initialised.current = true;
    }
  }, [serverGame, isOwner]);

  useEffect(() => {
    if (gameQuery.isError && !draft) {
      const cached = localStorage.getItem(draftKey);
      if (cached) {
        try {
          setDraft(JSON.parse(cached) as Game);
          setSaveState('offline');
        } catch {
          // ignore corrupt draft
        }
      }
    }
  }, [gameQuery.isError, draft, draftKey]);

  const { mutate: saveGame } = useMutation({
    mutationFn: (game: Game) =>
      api<{ game: Game }>(`/api/games/${game.id}`, {
        method: 'PATCH',
        body: JSON.stringify(toPayload(game)),
      }),
    onSuccess: (_result, game) => {
      lastSaved.current = JSON.stringify(toPayload(game));
      setSaveState('saved');
      queryClient.invalidateQueries({ queryKey: ['games'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
    onError: () => setSaveState('error'),
  });

  useEffect(() => {
    if (!draft || readOnly) return;
    const payload = JSON.stringify(toPayload(draft));
    localStorage.setItem(draftKey, payload);
    if (payload === lastSaved.current) return;
    if (!online) {
      setSaveState('offline');
      return;
    }
    setSaveState('saving');
    const timer = window.setTimeout(() => saveGame(draft), 900);
    return () => window.clearTimeout(timer);
  }, [draft, online, draftKey, readOnly, saveGame]);

  const remove = useMutation({
    mutationFn: () => api(`/api/games/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      localStorage.removeItem(draftKey);
      queryClient.invalidateQueries({ queryKey: ['games'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      navigate('/');
    },
  });

  const accept = useMutation({
    mutationFn: () => api(`/api/games/${id}/accept`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['game', id] });
      queryClient.invalidateQueries({ queryKey: ['games'] });
    },
  });

  const decline = useMutation({
    mutationFn: () => api(`/api/games/${id}/decline`, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['games'] });
      navigate('/');
    },
  });

  if (gameQuery.isLoading && !draft) {
    return <div className="page-loading">Loading game…</div>;
  }

  if (!serverGame && !draft) {
    return (
      <div className="card empty-state">
        <h2>Game not found</h2>
        <p className="muted">
          It may have been deleted, or you don’t have access to it. Ask the score master to add you to
          the group.
        </p>
        <Link to="/" className="btn">
          Back to games
        </Link>
      </div>
    );
  }

  const game = readOnly && serverGame ? serverGame : draft!;
  const config = gameConfig(game);
  const profile = deriveProfile(config);
  const validation = validateConfig(config, game.players.length);
  const ownerName = usersQuery.data?.users.find((account) => account.id === game.ownerId)?.name;
  const groupName = game.groupId
    ? groupsQuery.data?.groups.find((group) => group.id === game.groupId)?.name
    : undefined;

  function update(partial: Partial<Game>) {
    if (readOnly) return;
    setDraft((prev) => (prev ? { ...prev, ...partial } : prev));
  }

  function changeConfig(patch: Partial<GameConfig>) {
    if (readOnly) return;
    setDraft((prev) => {
      if (!prev) return prev;
      const nextConfig = normalizeConfig({
        expansions: patch.expansions ?? prev.expansions,
        goalBoard: patch.goalBoard ?? prev.goalBoard,
        asiaVariant: patch.asiaVariant ?? prev.asiaVariant,
      });
      const nextProfile = deriveProfile(nextConfig);
      const keys = fieldKeys(nextProfile);
      const boardChanged = nextConfig.goalBoard !== prev.goalBoard;
      const players = prev.players.map((player) => {
        const scores: ScoreMap = {};
        for (const key of keys) {
          scores[key] =
            boardChanged && key.startsWith('goalR')
              ? null
              : typeof player.scores[key] === 'number'
                ? player.scores[key]
                : null;
        }
        scores[TIEBREAK_KEY] =
          typeof player.scores[TIEBREAK_KEY] === 'number' ? player.scores[TIEBREAK_KEY] : null;
        return { ...player, scores };
      });
      return {
        ...prev,
        expansions: nextConfig.expansions,
        goalBoard: nextConfig.goalBoard,
        asiaVariant: nextConfig.asiaVariant,
        players,
      };
    });
  }

  function toggleExpansion(expansionId: string) {
    const next = config.expansions.includes(expansionId)
      ? config.expansions.filter((value) => value !== expansionId)
      : [...config.expansions, expansionId];
    const patch: Partial<GameConfig> = { expansions: next };
    if (!next.includes('asia')) patch.asiaVariant = 'none';
    changeConfig(patch);
  }

  function addPlayer() {
    if (readOnly) return;
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        players: [
          ...prev.players,
          {
            id: crypto.randomUUID(),
            name: `Player ${prev.players.length + 1}`,
            userId: null,
            status: 'accepted',
            scores: emptyScores(deriveProfile(gameConfig(prev))),
          },
        ],
      };
    });
  }

  function removePlayer(index: number) {
    if (readOnly) return;
    setDraft((prev) =>
      prev ? { ...prev, players: prev.players.filter((_, i) => i !== index) } : prev,
    );
  }

  return (
    <div className="stack">
      <div className="game-toolbar">
        <Link to="/" className="btn btn-ghost btn-sm">
          ← Games
        </Link>
        <div className="game-toolbar-fields">
          <label className="field inline">
            <span className="sr-only">Date</span>
            <input
              type="date"
              value={toDateInput(game.playedAt)}
              disabled={readOnly}
              onChange={(event) => update({ playedAt: fromDateInput(event.target.value) })}
            />
          </label>
          <label className="field inline">
            <span className="sr-only">Mode</span>
            <select
              value={game.mode}
              disabled={readOnly}
              onChange={(event) => update({ mode: event.target.value as GameMode })}
            >
              <option value="competitive">Competitive</option>
              <option value="solo">Solo</option>
              <option value="coop">Co-op</option>
            </select>
          </label>
          <label className="field inline">
            <span className="sr-only">Status</span>
            <select
              value={game.status}
              disabled={readOnly}
              onChange={(event) => update({ status: event.target.value as GameStatus })}
            >
              <option value="in_progress">In progress</option>
              <option value="completed">Completed</option>
            </select>
          </label>
        </div>
        <div className="game-toolbar-right">
          {readOnly ? (
            <span className="save-state save-live">
              {game.status === 'in_progress' ? '● Live — score master is editing' : '● View only'}
            </span>
          ) : (
            <span className={`save-state save-${saveState}`}>{SAVE_LABELS[saveState]}</span>
          )}
          {!readOnly && (
            <>
              <button
                type="button"
                className="btn btn-sm"
                onClick={addPlayer}
                disabled={game.players.length >= 8}
              >
                Add player
              </button>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => {
                  if (window.confirm('Delete this game? This cannot be undone.')) remove.mutate();
                }}
              >
                Delete
              </button>
            </>
          )}
        </div>
      </div>

      {isInvited && (
        <div className="card invite-banner">
          <div>
            <strong>{ownerName ?? 'The score master'}</strong> invited you to this game.
          </div>
          <div className="actions">
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={accept.isPending}
              onClick={() => accept.mutate()}
            >
              {accept.isPending ? 'Joining…' : 'Accept'}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={decline.isPending}
              onClick={() => decline.mutate()}
            >
              Decline
            </button>
          </div>
        </div>
      )}

      <div className="game-header">
        <h1>{profile.name}</h1>
        <p className="muted">
          {formatDateTime(game.playedAt)}
          {groupName ? ` · ${groupName}` : ''}
        </p>
        <p className="fine-print">
          Score master: {ownerName ?? (isOwner ? 'you' : 'someone else')}
          {readOnly ? ' · you can watch but not edit' : ''}
        </p>
      </div>

      <div className="card stack-sm">
        <h2>Game setup</h2>
        <div className="setup-row">
          <span className="setup-label">Expansions</span>
          <div className="chip-list">
            <span className="chip chip-static">Base</span>
            {SELECTABLE_EXPANSIONS.map((expansion) => (
              <button
                key={expansion.id}
                type="button"
                className={`chip${config.expansions.includes(expansion.id) ? ' chip-on' : ''}`}
                disabled={readOnly}
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
                disabled={readOnly}
                onClick={() => changeConfig({ goalBoard: board })}
              >
                {board === 'green' ? 'Green (majority)' : 'Blue (per item)'}
              </button>
            ))}
          </div>
        </div>

        {config.expansions.includes('asia') && (
          <label className="field">
            <span>Asia mode</span>
            <select
              value={config.asiaVariant}
              disabled={readOnly}
              onChange={(event) => changeConfig({ asiaVariant: event.target.value as AsiaVariant })}
            >
              <option value="none">Choose a mode…</option>
              <option value="duet">Duet — exactly 2 players</option>
              <option value="flock">Flock — 3 or more players</option>
            </select>
          </label>
        )}

        {!validation.valid && <p className="alert alert-error">{validation.error}</p>}
      </div>

      <ScoreSheet
        profile={profile}
        players={game.players as EditablePlayer[]}
        onChange={(players) => update({ players })}
        onRemovePlayer={removePlayer}
        readOnly={readOnly || isInvited}
      />

      <label className="field">
        <span>Notes</span>
        <textarea
          rows={3}
          value={game.notes ?? ''}
          placeholder="Anything memorable about this game?"
          disabled={readOnly}
          onChange={(event) => update({ notes: event.target.value })}
        />
      </label>
    </div>
  );
}
