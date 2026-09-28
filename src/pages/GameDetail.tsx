import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api';
import { useAuth, useOnline } from '../auth';
import { ScoreSheet, type EditablePlayer } from '../components/ScoreSheet';
import { deleteGame, gamePayload as toPayload, getGame, persistGame } from '../lib/gameService';
import { isLocalGameId } from '../lib/localGames';
import {
  checkComplete,
  deriveProfile,
  normalizeConfig,
  SELECTABLE_EXPANSIONS,
} from '../../shared/scoring';
import type { Game, GameConfig, PublicUser } from '../../shared/types';
import { formatDateTime, fromDateInput, toDateInput } from '../lib/format';

type SaveState = 'saved' | 'saving' | 'offline' | 'error';

function gameConfig(game: Game): GameConfig {
  return normalizeConfig({
    coreSets: game.coreSets,
    expansions: game.expansions,
    goalBoard: game.goalBoard,
  });
}

function readDraft(key: string): Game | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Game) : null;
  } catch {
    return null;
  }
}

function writeDraft(key: string, game: Game): void {
  try {
    localStorage.setItem(key, JSON.stringify(game));
  } catch {
    // ignore storage errors
  }
}

function clearDraft(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

const SAVE_LABELS: Record<SaveState, string> = {
  saved: 'Saved',
  saving: 'Saving…',
  offline: 'Offline — changes kept on this device',
  error: 'Could not save — will retry',
};

const STATUS_LABELS: Record<Game['status'], string> = {
  in_progress: 'In progress',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export function GameDetail() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const online = useOnline();
  const { user } = useAuth();
  const isLocal = isLocalGameId(id);
  const draftKey = `wp-draft-${id}`;

  const friendsQuery = useQuery({
    queryKey: ['users'],
    queryFn: () => api<{ users: PublicUser[] }>('/api/users'),
    enabled: Boolean(user) && !isLocal,
  });

  const gameQuery = useQuery({
    queryKey: ['game', id],
    queryFn: () => getGame(user, id),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      if (query.state.status === 'error') return false;
      const game = query.state.data;
      // Poll while in progress so invite acceptances and live score changes
      // reach everyone, including the score master.
      if (game && game.status === 'in_progress') return 5000;
      return false;
    },
  });

  // The game was deleted (or access was revoked) while we were viewing it.
  const gameGone =
    gameQuery.isError && gameQuery.error instanceof ApiError && gameQuery.error.status === 404;

  const [draft, setDraft] = useState<Game | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const lastSaved = useRef('');
  const initialised = useRef(false);

  const serverGame = gameQuery.data;
  const isOwner = isLocal || Boolean(serverGame && user && serverGame.ownerId === user.id);
  const readOnly = Boolean(serverGame) && !isOwner;
  const myPlayer = serverGame?.players.find((player) => player.userId === user?.id);
  const isInvited = myPlayer?.status === 'pending';

  // Reset the editable copy when moving to a different game (same route,
  // different :id, e.g. browser back/forward between games).
  useEffect(() => {
    initialised.current = false;
    setDraft(null);
  }, [id]);

  useEffect(() => {
    if (!serverGame || initialised.current) return;
    // Prefer an unsaved local draft (offline edits) over the server copy.
    const cachedDraft = readDraft(draftKey);
    setDraft(cachedDraft ?? serverGame);
    lastSaved.current = JSON.stringify(toPayload(serverGame));
    if (cachedDraft) setSaveState('offline');
    initialised.current = true;
  }, [serverGame, draftKey]);

  // Keep server-managed player metadata (name/email/status) in sync while the
  // owner edits, without touching their local score edits.
  useEffect(() => {
    if (!serverGame || !initialised.current) return;
    setDraft((prev) => {
      if (!prev) return prev;
      let changed = false;
      const players = prev.players.map((player) => {
        const server = serverGame.players.find((candidate) => candidate.id === player.id);
        if (!server) return player;
        if (
          server.status !== player.status ||
          server.name !== player.name ||
          (server.email ?? null) !== (player.email ?? null) ||
          server.userId !== player.userId
        ) {
          changed = true;
          return {
            ...player,
            status: server.status,
            name: server.name,
            email: server.email ?? null,
            userId: server.userId,
          };
        }
        return player;
      });
      return changed ? { ...prev, players } : prev;
    });
  }, [serverGame]);

  useEffect(() => {
    // No server copy (offline with no cached response): fall back to the local
    // draft so an in-progress game is never lost on reload.
    if (serverGame || draft || !gameQuery.isError) return;
    const cachedDraft = readDraft(draftKey);
    if (cachedDraft) {
      setDraft(cachedDraft);
      lastSaved.current = '';
      setSaveState('offline');
      initialised.current = true;
    }
  }, [serverGame, draft, draftKey, gameQuery.isError]);

  const { mutate: saveGame } = useMutation({
    mutationFn: (game: Game) => persistGame(user, game),
    onSuccess: (_result, game) => {
      lastSaved.current = JSON.stringify(toPayload(game));
      clearDraft(draftKey);
      setSaveError(null);
      setSaveState('saved');
      queryClient.invalidateQueries({ queryKey: ['games'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
    onError: (error: Error) => {
      console.error('Save failed', error);
      setSaveError(error.message);
      setSaveState('error');
    },
  });

  useEffect(() => {
    if (!draft || readOnly || gameGone) return;
    // A server game can't be saved until the session is known.
    if (!isLocal && !user) return;
    const payload = JSON.stringify(toPayload(draft));
    if (payload === lastSaved.current) return;
    // Persist immediately so an offline reload keeps the current state.
    writeDraft(draftKey, draft);
    if (!online) {
      setSaveState('offline');
      return;
    }
    setSaveState('saving');
    const timer = window.setTimeout(() => saveGame(draft), 900);
    return () => window.clearTimeout(timer);
  }, [draft, online, draftKey, readOnly, user, isLocal, gameGone, saveGame]);

  // Automatically retry a failed save while we're online.
  useEffect(() => {
    if (saveState !== 'error' || !draft || !online) return;
    const timer = window.setTimeout(() => saveGame(draft), 3000);
    return () => window.clearTimeout(timer);
  }, [saveState, draft, online, saveGame]);

  // If the game was deleted while we were watching, drop it from the cached
  // lists so it doesn't linger on the dashboard.
  useEffect(() => {
    if (!gameGone) return;
    queryClient.invalidateQueries({ queryKey: ['games'] });
    queryClient.invalidateQueries({ queryKey: ['stats'] });
  }, [gameGone, queryClient]);

  const remove = useMutation({
    mutationFn: () => deleteGame(user, id),
    onSuccess: () => {
      clearDraft(draftKey);
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

  if (gameGone) {
    return (
      <div className="card empty-state">
        <h2>Game no longer available</h2>
        <p className="muted">This game was deleted by the score master.</p>
        <Link to="/" className="btn">
          Back to games
        </Link>
      </div>
    );
  }

  if (gameQuery.isLoading && !draft) {
    return <div className="page-loading">Loading game…</div>;
  }

  if (!serverGame && !draft) {
    return (
      <div className="card empty-state">
        <h2>Game not found</h2>
        <p className="muted">It may have been deleted, or you don’t have access to it.</p>
        <Link to="/" className="btn">
          Back to games
        </Link>
      </div>
    );
  }

  // Prefer the editable draft, but fall back to the server copy on the first
  // render after load (before the sync effect has populated the draft).
  // Read-only viewers should always see the live server copy; the owner edits
  // the local draft (falling back to the server copy before it is populated).
  const game = (readOnly && serverGame ? serverGame : (draft ?? serverGame))!;
  const config = gameConfig(game);
  const profile = deriveProfile(config);
  const ownerName = game.ownerName;
  const friendIds = new Set((friendsQuery.data?.users ?? []).map((friend) => friend.id));

  function update(partial: Partial<Game>) {
    if (readOnly) return;
    setDraft((prev) => (prev ? { ...prev, ...partial } : prev));
  }

  function completeGame() {
    const check = checkComplete(
      profile,
      game.players.map((player) => ({ name: player.name, scores: player.scores })),
    );
    if (!check.valid) {
      setCompleteError(check.error ?? 'The game is not ready to complete.');
      return;
    }
    setCompleteError(null);
    update({ status: 'completed' });
  }

  return (
    <div className="stack">
      <div className="game-toolbar">
        <Link to="/" className="btn btn-ghost btn-sm">
          ← Games
        </Link>
        <div className="game-toolbar-right">
          {readOnly ? (
            <span className="save-state save-live">
              {game.status === 'in_progress' ? '● Live — score master is editing' : '● View only'}
            </span>
          ) : (
            <span className={`save-state save-${saveState}`} title={saveError ?? undefined}>
              {saveState === 'error' && saveError
                ? `Could not save: ${saveError}`
                : SAVE_LABELS[saveState]}
            </span>
          )}
          {!readOnly && (
            <>
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
          <span className={`badge${game.status === 'in_progress' ? ' badge-warn' : ''}`}>
            {STATUS_LABELS[game.status]}
          </span>{' '}
          {formatDateTime(game.playedAt)}
        </p>
        <p className="fine-print">
          Score master: {ownerName ?? (isOwner ? 'you' : 'someone else')}
          {readOnly ? ' · you can watch but not edit' : ''}
        </p>
      </div>

      <div className="card stack-sm">
        <h2>Game setup</h2>
        {game.status === 'in_progress' && (
          <label className="field">
            <span>Date played</span>
            <input
              type="date"
              value={toDateInput(game.playedAt)}
              disabled={readOnly}
              onChange={(event) => update({ playedAt: fromDateInput(event.target.value) })}
            />
          </label>
        )}
        <div className="setup-row">
          <span className="setup-label">Expansions</span>
          <div className="chip-list">
            <span className="chip chip-static">Base</span>
            {SELECTABLE_EXPANSIONS.filter((expansion) =>
              config.expansions.includes(expansion.id),
            ).map((expansion) => (
              <span key={expansion.id} className="chip chip-static">
                {expansion.short}
              </span>
            ))}
          </div>
        </div>

        <div className="setup-row">
          <span className="setup-label">Goal board</span>
          <span className="badge">
            {config.goalBoard === 'green' ? 'Green (majority)' : 'Blue (per item)'}
          </span>
        </div>

        <p className="fine-print">The setup and players are fixed when the game is created.</p>
      </div>

      <div className={`score-block${readOnly ? '' : ' has-actions'}`}>
        <ScoreSheet
          profile={profile}
          players={game.players as EditablePlayer[]}
          onChange={(players) => update({ players })}
          knownUserIds={friendIds}
          readOnly={readOnly || isInvited}
        />
        {!readOnly && (
          <div className="score-actions">
            {game.status === 'in_progress' ? (
              <>
                <button type="button" className="btn btn-primary" onClick={completeGame}>
                  Complete game
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => update({ status: 'cancelled' })}
                >
                  Cancel game
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn"
                onClick={() => update({ status: 'in_progress' })}
              >
                Reopen game
              </button>
            )}
          </div>
        )}
      </div>
      {completeError && <p className="alert alert-error">{completeError}</p>}

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
