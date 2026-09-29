import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ScoreSheet, type EditablePlayer } from '../components/ScoreSheet';
import { WinnerCelebration } from '../components/WinnerCelebration';
import { clearDraft, useGameDraft, type SaveState } from '../hooks/useGameDraft';
import { deleteGame } from '../lib/gameService';
import { isLocalGameId } from '../lib/localGames';
import {
  checkComplete,
  computeGame,
  deriveProfile,
  normalizeConfig,
  SELECTABLE_EXPANSIONS,
} from '../../shared/scoring';
import type { Game, PublicUser } from '../../shared/types';
import { formatDateTime, fromDateInput, toDateInput } from '../lib/format';

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

type Confirming = 'complete' | 'cancel' | 'delete' | null;

/** Route wrapper: remount per game so no state leaks between games. */
export function GameDetail() {
  const { id = '' } = useParams();
  return <GameView key={id} id={id} />;
}

function GameView({ id }: { id: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { game, serverGame, loading, gone, isOwner, readOnly, saveState, saveError, update } =
    useGameDraft(id);

  const friendsQuery = useQuery({
    queryKey: ['users'],
    queryFn: () => api<{ users: PublicUser[] }>('/api/users'),
    enabled: Boolean(user) && !isLocalGameId(id),
  });

  const [confirming, setConfirming] = useState<Confirming>(null);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  // Pop the winner celebration when the game becomes completed — including for
  // viewers who see it through polling. (Adjusting state during render is
  // React's recommended way to respond to a changed value.)
  const status = game?.status;
  const [previousStatus, setPreviousStatus] = useState(status);
  if (status !== previousStatus) {
    setPreviousStatus(status);
    if (status === 'completed' && previousStatus && previousStatus !== 'completed') {
      setCelebrate(true);
    }
  }

  const remove = useMutation({
    mutationFn: () => deleteGame(user, id),
    onSuccess: () => {
      clearDraft(id);
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

  if (gone) {
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

  if (loading) return <div className="page-loading">Loading game…</div>;

  if (!game) {
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

  const config = normalizeConfig(game);
  const profile = deriveProfile(config);
  const ownerName = game.ownerName;
  const isInvited =
    serverGame?.players.find((player) => player.userId === user?.id)?.status === 'pending';
  const friendIds = new Set((friendsQuery.data?.users ?? []).map((friend) => friend.id));
  const computed = computeGame(profile, game.players);
  const winnerNames = computed.winners
    .map((index) => game.players[index]?.name)
    .filter((name): name is string => Boolean(name));
  const standings = game.players
    .map((player, index) => ({ name: player.name, total: computed.totals[index] ?? 0, index }))
    .sort((a, b) => b.total - a.total);
  const completion = checkComplete(profile, game.players);
  const invalidFields = new Set(
    completion.fields.map((field) => `${field.player}:${field.key}`),
  );

  function requestComplete() {
    if (!completion.valid) {
      setCompleteError(completion.error ?? 'The game is not ready to complete.');
      // Bring the first field that needs attention into view.
      const first = sheetRef.current?.querySelector<HTMLElement>(
        '.score-input-invalid input, .field-invalid',
      );
      first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      first?.focus({ preventScroll: true });
      return;
    }
    setCompleteError(null);
    setConfirming('complete');
  }

  function confirm() {
    if (confirming === 'complete') update({ status: 'completed' });
    if (confirming === 'cancel') update({ status: 'cancelled' });
    if (confirming === 'delete') remove.mutate();
    setConfirming(null);
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
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={() => setConfirming('delete')}
            >
              Delete
            </button>
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

      <div className={`score-block${readOnly ? '' : ' has-actions'}`} ref={sheetRef}>
        <ScoreSheet
          profile={profile}
          players={game.players as EditablePlayer[]}
          onChange={(players) => {
            setCompleteError(null);
            update({ players });
          }}
          knownUserIds={friendIds}
          invalidFields={invalidFields}
          readOnly={readOnly || isInvited}
        />
        {!readOnly && (
          <div className="score-actions">
            {completeError && (
              <p className="alert alert-error score-actions-error" role="alert">
                {completeError}
              </p>
            )}
            {game.status === 'in_progress' ? (
              <>
                <button type="button" className="btn btn-primary" onClick={requestComplete}>
                  Complete game
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setConfirming('cancel')}
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

      {confirming === 'complete' && (
        <ConfirmDialog
          title="Complete this game?"
          confirmLabel="Complete game"
          onConfirm={confirm}
          onCancel={() => setConfirming(null)}
        >
          <ol className="final-standings">
            {standings.map((entry) => (
              <li key={entry.index} className={computed.winners.includes(entry.index) ? 'winner' : ''}>
                <span>
                  {computed.winners.includes(entry.index) && '🏆 '}
                  {entry.name}
                </span>
                <strong>{entry.total}</strong>
              </li>
            ))}
          </ol>
          <p className="fine-print">
            Completed games count towards everyone’s stats. You can reopen it later.
          </p>
        </ConfirmDialog>
      )}
      {confirming === 'cancel' && (
        <ConfirmDialog
          title="Cancel this game?"
          confirmLabel="Cancel game"
          cancelLabel="Keep playing"
          danger
          onConfirm={confirm}
          onCancel={() => setConfirming(null)}
        >
          <p>Cancelled games are kept but don’t count towards stats. You can reopen it later.</p>
        </ConfirmDialog>
      )}
      {confirming === 'delete' && (
        <ConfirmDialog
          title="Delete this game?"
          confirmLabel="Delete"
          danger
          onConfirm={confirm}
          onCancel={() => setConfirming(null)}
        >
          <p>This removes the game for every player and cannot be undone.</p>
        </ConfirmDialog>
      )}

      {celebrate && winnerNames.length > 0 && (
        <WinnerCelebration winners={winnerNames} onClose={() => setCelebrate(false)} />
      )}
    </div>
  );
}
