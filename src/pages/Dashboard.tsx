import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../hooks/useAuth';
import { listGames } from '../lib/gameService';
import { deriveProfile, normalizeConfig } from '../../shared/scoring';
import type { GameSummary, PublicUser, Stats } from '../../shared/types';
import { formatDate } from '../lib/format';

const RECENT_LIMIT = 12;

function GameCard({
  game,
  currentUserId,
  knownUserIds,
}: {
  game: GameSummary;
  currentUserId?: string;
  knownUserIds?: Set<string>;
}) {
  const players = [...game.players].sort((a, b) => b.total - a.total);
  const winnerIds = new Set(game.winners);
  const profileName = deriveProfile(
    normalizeConfig(game),
  ).name;
  const isInvited = currentUserId
    ? game.players.some((player) => player.userId === currentUserId && player.status === 'pending')
    : false;
  const isActive = game.status === 'in_progress';

  return (
    <Link
      to={`/games/${game.id}`}
      className={`game-card card${isActive ? ' game-card-active' : ''}`}
    >
      <div className="game-card-head">
        <div>
          <div className="game-date">{formatDate(game.playedAt)}</div>
          <div className="game-meta">
            <span className="badge">{profileName}</span>
            {isInvited && <span className="badge badge-warn">Invitation</span>}
            {isActive && <span className="badge badge-live">● In progress</span>}
            {game.status === 'completed' && <span className="badge">Completed</span>}
            {game.status === 'cancelled' && <span className="badge">Cancelled</span>}
          </div>
        </div>
        <span className="chevron" aria-hidden="true">
          ›
        </span>
      </div>
      <ul className="score-list">
        {players.map((player) => (
          <li key={player.id} className={winnerIds.has(player.id) ? 'winner' : ''}>
            <span className="pname">
              {winnerIds.has(player.id) && <span aria-hidden="true">🏆 </span>}
              {player.status === 'pending' &&
              !(player.userId && knownUserIds?.has(player.userId))
                ? (player.email ?? 'Invited player')
                : player.name}
              {player.status === 'pending' && <span className="muted"> (invited)</span>}
            </span>
            <span className="ptotal">{player.total}</span>
          </li>
        ))}
      </ul>
    </Link>
  );
}

export function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showAllRecent, setShowAllRecent] = useState(false);

  const gamesQuery = useQuery({
    queryKey: ['games', user?.id ?? 'local'],
    queryFn: () => listGames(user),
    // Poll so a new invitation shows up without a manual refresh.
    refetchInterval: user ? 15000 : false,
  });

  const accept = useMutation({
    mutationFn: (id: string) => api(`/api/games/${id}/accept`, { method: 'POST' }),
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ['games'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      // Go straight into the game once you've accepted it.
      navigate(`/games/${id}`);
    },
  });
  const decline = useMutation({
    mutationFn: (id: string) => api(`/api/games/${id}/decline`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['games'] }),
  });
  const statsQuery = useQuery({
    queryKey: ['stats', 'me'],
    queryFn: () => api<{ stats: Stats }>('/api/stats'),
    enabled: Boolean(user),
  });
  const friendsQuery = useQuery({
    queryKey: ['users'],
    queryFn: () => api<{ users: PublicUser[] }>('/api/users'),
    enabled: Boolean(user),
  });
  const friendIds = new Set((friendsQuery.data?.users ?? []).map((friend) => friend.id));

  const stats = statsQuery.data?.stats;
  const games = gamesQuery.data ?? [];
  const invitedGames = games.filter((game) =>
    game.players.some((player) => player.userId === user?.id && player.status === 'pending'),
  );
  const activeGames = games
    .filter((game) => game.status === 'in_progress')
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const finishedGames = games
    .filter((game) => game.status !== 'in_progress')
    .sort((a, b) => b.playedAt - a.playedAt);
  const visibleRecent = showAllRecent ? finishedGames : finishedGames.slice(0, RECENT_LIMIT);

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Games</h1>
          <p className="muted">
            Welcome back{user?.name ? `, ${user.name.split(' ')[0]}` : ''}. Your Wingspan games and
            how you are doing.
          </p>
        </div>
        <Link to="/games/new" className="btn btn-primary">
          New game
        </Link>
      </div>

      {user ? (
        <section className="stat-grid">
          <div className="stat-card card">
            <span className="stat-label">Games played</span>
            <span className="stat-value">{stats?.totals.completed ?? '—'}</span>
          </div>
          <div className="stat-card card">
            <span className="stat-label">Wins</span>
            <span className="stat-value">{stats?.totals.wins ?? '—'}</span>
          </div>
          <div className="stat-card card">
            <span className="stat-label">Win rate</span>
            <span className="stat-value">
              {stats ? `${Math.round(stats.totals.winRate * 100)}%` : '—'}
            </span>
          </div>
          <div className="stat-card card">
            <span className="stat-label">Average score</span>
            <span className="stat-value">{stats?.totals.averageScore ?? '—'}</span>
          </div>
          <div className="stat-card card">
            <span className="stat-label">Best score</span>
            <span className="stat-value">{stats?.totals.bestScore || '—'}</span>
          </div>
        </section>
      ) : (
        <p className="muted">
          You’re playing as a guest. Games are saved on this device — <Link to="/login">sign in</Link> to
          track stats across games and devices.
        </p>
      )}

      {gamesQuery.isLoading && <p className="muted">Loading games…</p>}
      {gamesQuery.isError && (
        <div className="card empty-state">
          <p>Could not load games. You may be offline.</p>
        </div>
      )}

      {!gamesQuery.isLoading && games.length === 0 && (
        <div className="card empty-state">
          <div className="brand-mark large">🪶</div>
          <h3>No games yet</h3>
          <p className="muted">Start a new game to keep score and build up your stats.</p>
          <Link to="/games/new" className="btn btn-primary">
            New game
          </Link>
        </div>
      )}

      {invitedGames.length > 0 && (
        <section>
          <div className="section-head">
            <h2>Invitations</h2>
            <span className="muted">{invitedGames.length}</span>
          </div>
          <div className="stack-sm">
            {invitedGames.map((game) => (
              <div key={game.id} className="card invite-banner">
                <div>
                  <strong>{game.ownerName ?? 'Someone'}</strong> invited you to a game on{' '}
                  {formatDate(game.playedAt)}. Accepting adds it to your games and stats.
                </div>
                <div className="actions">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={accept.isPending}
                    onClick={() => accept.mutate(game.id)}
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={decline.isPending}
                    onClick={() => decline.mutate(game.id)}
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {activeGames.length > 0 && (
        <section>
          <div className="section-head">
            <h2>In progress</h2>
            <span className="muted">{activeGames.length}</span>
          </div>
          <div className="game-list">
            {activeGames.map((game) => (
              <GameCard
                key={game.id}
                game={game}
                currentUserId={user?.id}
                knownUserIds={friendIds}
              />
            ))}
          </div>
        </section>
      )}

      {finishedGames.length > 0 && (
        <section>
          <div className="section-head">
            <h2>Recent games</h2>
            <div className="section-head-actions">
              <span className="muted">
                {visibleRecent.length} of {finishedGames.length}
              </span>
              {finishedGames.length > RECENT_LIMIT && (
                <button
                  type="button"
                  className="link"
                  onClick={() => setShowAllRecent((value) => !value)}
                >
                  {showAllRecent ? 'Show less' : 'Show all'}
                </button>
              )}
            </div>
          </div>
          <div className="game-list">
            {visibleRecent.map((game) => (
              <GameCard
                key={game.id}
                game={game}
                currentUserId={user?.id}
                knownUserIds={friendIds}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
