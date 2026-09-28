import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth, useOnline } from '../auth';
import { ScoreSheet, type EditablePlayer } from '../components/ScoreSheet';
import { deleteGame, gamePayload as toPayload, getGame, persistGame } from '../lib/gameService';
import { isLocalGameId } from '../lib/localGames';
import {
  deriveProfile,
  emptyScores,
  fieldKeys,
  GOAL_ROUNDS,
  goalRoundKey,
  normalizeConfig,
  SELECTABLE_EXPANSIONS,
  TIEBREAK_KEY,
  validateConfig,
} from '../../shared/scoring';
import type { Game, GameConfig, GoalBoard, PublicUser, ScoreMap } from '../../shared/types';
import { formatDateTime, fromDateInput, toDateInput } from '../lib/format';
import { newId } from '../lib/id';

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

  const gameQuery = useQuery({
    queryKey: ['game', id],
    queryFn: () => getGame(user, id),
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const game = query.state.data;
      if (game && game.ownerId !== user?.id && game.status === 'in_progress') return 5000;
      return false;
    },
  });

  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: () => api<{ users: PublicUser[] }>('/api/users'),
    enabled: Boolean(user) && !isLocal,
  });

  const [draft, setDraft] = useState<Game | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [saveError, setSaveError] = useState<string | null>(null);
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
    // Merge onto the server copy so older drafts (which lacked id/ownerId) still
    // load and can be recovered.
    setDraft(cachedDraft ? { ...serverGame, ...cachedDraft, id } : serverGame);
    lastSaved.current = JSON.stringify(toPayload(serverGame));
    if (cachedDraft) setSaveState('offline');
    initialised.current = true;
  }, [serverGame, draftKey]);

  useEffect(() => {
    // No server copy (offline with no cached response): fall back to the local
    // draft so an in-progress game is never lost on reload.
    if (serverGame || draft || !gameQuery.isError) return;
    const cachedDraft = readDraft(draftKey);
    if (cachedDraft) {
      setDraft({ ...cachedDraft, id });
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
    if (!draft || readOnly) return;
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
  }, [draft, online, draftKey, readOnly, user, isLocal, saveGame]);

  // Automatically retry a failed save while we're online.
  useEffect(() => {
    if (saveState !== 'error' || !draft || !online) return;
    const timer = window.setTimeout(() => saveGame(draft), 3000);
    return () => window.clearTimeout(timer);
  }, [saveState, draft, online, saveGame]);

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
  const validation = validateConfig(config, game.players.length);
  const ownerName = usersQuery.data?.users.find((account) => account.id === game.ownerId)?.name;

  function update(partial: Partial<Game>) {
    if (readOnly) return;
    setDraft((prev) => (prev ? { ...prev, ...partial } : prev));
  }

  function changeConfig(patch: Partial<GameConfig>) {
    if (readOnly) return;
    setDraft((prev) => {
      if (!prev) return prev;
      const nextConfig = normalizeConfig({
        coreSets: patch.coreSets ?? prev.coreSets,
        expansions: patch.expansions ?? prev.expansions,
        goalBoard: patch.goalBoard ?? prev.goalBoard,
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
        coreSets: nextConfig.coreSets,
        expansions: nextConfig.expansions,
        goalBoard: nextConfig.goalBoard,
        players,
      };
    });
  }

  function toggleExpansion(expansionId: string) {
    const next = config.expansions.includes(expansionId)
      ? config.expansions.filter((value) => value !== expansionId)
      : [...config.expansions, expansionId];
    changeConfig({ expansions: next });
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
            id: newId(),
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
    setDraft((prev) => {
      if (!prev) return prev;
      const players = prev.players.filter((_, i) => i !== index);
      const profile = deriveProfile(gameConfig(prev));
      const maxPlace = Math.min(3, players.length);
      // A 3rd-place goal no longer exists when the game drops to 2 players.
      const adjusted =
        profile.goalBoard === 'green' && maxPlace < 3
          ? players.map((player) => {
              const scores = { ...player.scores };
              for (let round = 1; round <= GOAL_ROUNDS; round += 1) {
                const key = goalRoundKey(round);
                const value = scores[key];
                if (typeof value === 'number' && value > maxPlace) scores[key] = null;
              }
              return { ...player, scores };
            })
          : players;
      return { ...prev, players: adjusted };
    });
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
              {game.status === 'in_progress' && (
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={addPlayer}
                  disabled={game.players.length >= 8}
                >
                  Add player
                </button>
              )}
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

        {!validation.valid && <p className="alert alert-error">{validation.error}</p>}
      </div>

      <div className={`score-block${readOnly ? '' : ' has-actions'}`}>
        <ScoreSheet
          profile={profile}
          players={game.players as EditablePlayer[]}
          onChange={(players) => update({ players })}
          onRemovePlayer={game.status === 'in_progress' ? removePlayer : undefined}
          readOnly={readOnly || isInvited}
        />
        {!readOnly && (
          <div className="score-actions">
            {game.status === 'in_progress' ? (
              <>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => update({ status: 'completed' })}
                >
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
