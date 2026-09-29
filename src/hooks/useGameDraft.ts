import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../api';
import { useAuth } from './useAuth';
import { useOnline } from './useOnline';
import { gamePayload, getGame, persistGame } from '../lib/gameService';
import { isLocalGameId } from '../lib/localGames';
import type { Game } from '../../shared/types';

export type SaveState = 'saved' | 'saving' | 'offline' | 'error';

const SAVE_DELAY_MS = 900;
const RETRY_DELAY_MS = 3000;

/* Offline drafts: unsaved edits survive a reload or going offline. */

function draftKey(id: string): string {
  return `wp-draft-${id}`;
}

function readDraft(id: string): Game | null {
  try {
    const raw = localStorage.getItem(draftKey(id));
    return raw ? (JSON.parse(raw) as Game) : null;
  } catch {
    return null;
  }
}

function writeDraft(game: Game): void {
  try {
    localStorage.setItem(draftKey(game.id), JSON.stringify(game));
  } catch {
    // ignore storage errors
  }
}

export function clearDraft(id: string): void {
  try {
    localStorage.removeItem(draftKey(id));
  } catch {
    // ignore
  }
}

/**
 * Server-managed player details (names, emails, invite status) can change
 * while the owner edits (e.g. an invitee accepts). Take those from the server
 * copy without touching the owner's local score edits.
 */
function withServerDetails(draft: Game, server: Game | undefined): Game {
  if (!server) return draft;
  return {
    ...draft,
    ownerName: server.ownerName,
    players: draft.players.map((player) => {
      const current = server.players.find((candidate) => candidate.id === player.id);
      if (!current) return player;
      return {
        ...player,
        name: current.name,
        email: current.email ?? null,
        userId: current.userId,
        status: current.status,
      };
    }),
  };
}

const payloadOf = (game: Game) => JSON.stringify(gamePayload(game));

/**
 * Loads a game and manages the owner's editable copy: auto-saves shortly
 * after each edit, keeps unsaved edits on the device while offline and
 * retries failed saves. Viewers who aren't the owner always see the live
 * server copy (polled while the game is in progress).
 *
 * Mount one instance per game id (e.g. `key={id}`); state is not reset when
 * the id changes.
 */
export function useGameDraft(id: string) {
  const queryClient = useQueryClient();
  const online = useOnline();
  const { user } = useAuth();
  const isLocal = isLocalGameId(id);

  const query = useQuery({
    queryKey: ['game', id],
    queryFn: () => getGame(user, id),
    enabled: Boolean(id),
    // Poll while in progress so invite acceptances and live score changes
    // reach everyone, including the score master.
    refetchInterval: (current) =>
      current.state.status !== 'error' && current.state.data?.status === 'in_progress'
        ? 5000
        : false,
  });
  const serverGame = query.data;
  const gone = query.error instanceof ApiError && query.error.status === 404;

  // The owner's local copy, created on the first edit (or restored from an
  // unsaved offline draft). `null` means "no local edits: show the server".
  const [draft, setDraft] = useState<Game | null>(() => readDraft(id));
  const [saveState, setSaveState] = useState<SaveState>(() =>
    readDraft(id) ? 'offline' : 'saved',
  );
  const [saveError, setSaveError] = useState<string | null>(null);

  const draftRef = useRef(draft);
  const lastSaved = useRef<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const isOwner = isLocal || Boolean(serverGame && user && serverGame.ownerId === user.id);
  const readOnly = Boolean(serverGame) && !isOwner;
  const canSave = !readOnly && !gone && (isLocal || Boolean(user));

  const game: Game | null =
    readOnly || !draft ? (serverGame ?? draft) : withServerDetails(draft, serverGame);

  const { mutate: save } = useMutation({
    mutationFn: (next: Game) => persistGame(user, next),
    onSuccess: (saved, sent) => {
      lastSaved.current = payloadOf(sent);
      // Only drop the offline copy if nothing changed while saving.
      if (draftRef.current && payloadOf(draftRef.current) === lastSaved.current) {
        clearDraft(id);
        setSaveState('saved');
      }
      setSaveError(null);
      queryClient.setQueryData(['game', id], saved);
      queryClient.invalidateQueries({ queryKey: ['games'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
    },
    onError: (error: Error) => {
      console.error('Save failed', error);
      setSaveError(error.message);
      setSaveState('error');
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => flush(), RETRY_DELAY_MS);
    },
  });

  /** Save the current draft now if it has unsaved changes. */
  const flush = useCallback(() => {
    const current = draftRef.current;
    if (!current || !canSave || !navigator.onLine) return;
    if (payloadOf(current) === lastSaved.current) return;
    save(current);
  }, [canSave, save]);

  /** Apply an edit to the owner's copy and schedule an auto-save. */
  const update = useCallback(
    (partial: Partial<Game>) => {
      if (!canSave) return;
      const base = draftRef.current ?? serverGame;
      if (!base) return;
      const next = { ...base, ...partial };
      draftRef.current = next;
      setDraft(next);
      // Persist immediately so a reload or going offline keeps the edit.
      writeDraft(next);
      window.clearTimeout(timer.current);
      if (!navigator.onLine) {
        setSaveState('offline');
        return;
      }
      setSaveState('saving');
      timer.current = window.setTimeout(() => flush(), SAVE_DELAY_MS);
    },
    [canSave, serverGame, flush],
  );

  // Sync unsaved edits when we come back online (or once the session is
  // known after a reload with an offline draft).
  useEffect(() => {
    if (online) flush();
  }, [online, flush]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  // Drop a deleted game from the cached lists so it doesn't linger.
  useEffect(() => {
    if (!gone) return;
    clearDraft(id);
    queryClient.invalidateQueries({ queryKey: ['games'] });
    queryClient.invalidateQueries({ queryKey: ['stats'] });
  }, [gone, id, queryClient]);

  return {
    game,
    serverGame,
    loading: query.isLoading && !game,
    gone,
    isOwner,
    readOnly,
    saveState,
    saveError,
    update,
  };
}
