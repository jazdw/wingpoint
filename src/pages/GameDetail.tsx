import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth, useOnline } from '../auth';
import { ScoreSheet, type EditablePlayer } from '../components/ScoreSheet';
import { emptyScores, fieldKeys, getProfile, PROFILES, TIEBREAK_KEY } from '../../shared/scoring';
import type { Game, GameMode, GameStatus, Group, PublicUser, ScoreMap } from '../../shared/types';
import { formatDateTime, fromDateInput, toDateInput } from '../lib/format';

type SaveState = 'saved' | 'saving' | 'offline' | 'error';

function toPayload(game: Game) {
  return {
    playedAt: game.playedAt,
    mode: game.mode,
    status: game.status,
    scoringProfile: game.scoringProfile,
    expansions: game.expansions,
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
    // Non-owners watching an in-progress game poll for live updates.
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
  const profile = getProfile(game.scoringProfile);
  const ownerName = usersQuery.data?.users.find((account) => account.id === game.ownerId)?.name;
  const groupName = game.groupId
    ? groupsQuery.data?.groups.find((group) => group.id === game.groupId)?.name
    : undefined;

  function update(partial: Partial<Game>) {
    if (readOnly) return;
    setDraft((prev) => (prev ? { ...prev, ...partial } : prev));
  }

  function changeProfile(nextProfileId: string) {
    if (readOnly) return;
    const nextProfile = getProfile(nextProfileId);
    const keys = fieldKeys(nextProfile);
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        scoringProfile: nextProfileId,
        expansions: nextProfile.expansions,
        players: prev.players.map((player) => {
          const scores: ScoreMap = {};
          for (const key of keys) {
            scores[key] = typeof player.scores[key] === 'number' ? player.scores[key] : null;
          }
          scores[TIEBREAK_KEY] =
            typeof player.scores[TIEBREAK_KEY] === 'number' ? player.scores[TIEBREAK_KEY] : null;
          return { ...player, scores };
        }),
      };
    });
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
            scores: emptyScores(getProfile(prev.scoringProfile)),
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
            <span className="sr-only">Scoring profile</span>
            <select
              value={game.scoringProfile}
              disabled={readOnly}
              onChange={(event) => changeProfile(event.target.value)}
            >
              {PROFILES.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
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

      <div className="game-header">
        <h1>{profile.name}</h1>
        <p className="muted">
          {formatDateTime(game.playedAt)} · {game.expansions.join(' · ')}
          {groupName ? ` · ${groupName}` : ''}
        </p>
        <p className="fine-print">
          Score master: {ownerName ?? (isOwner ? 'you' : 'someone else')}
          {readOnly ? ' · you can watch but not edit' : ''}
        </p>
      </div>

      <ScoreSheet
        profileId={game.scoringProfile}
        players={game.players as EditablePlayer[]}
        onChange={(players) => update({ players })}
        onRemovePlayer={removePlayer}
        readOnly={readOnly}
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
