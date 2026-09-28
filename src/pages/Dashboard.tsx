import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { deriveProfile, normalizeConfig } from '../../shared/scoring';
import type { GameSummary, Stats } from '../../shared/types';
import { formatDate } from '../lib/format';

function GameCard({
  game,
  currentUserId,
}: {
  game: GameSummary;
  currentUserId?: string;
}) {
  const players = [...game.players].sort((a, b) => b.total - a.total);
  const winnerIds = new Set(game.winners);
  const profileName = deriveProfile(
    normalizeConfig({
      coreSets: game.coreSets,
      expansions: game.expansions,
      goalBoard: game.goalBoard,
    }),
  ).name;
  const isInvited = currentUserId
    ? game.players.some((player) => player.userId === currentUserId && player.status === 'pending')
    : false;

  return (
    <Link to={`/games/${game.id}`} className="game-card card">
      <div className="game-card-head">
        <div>
          <div className="game-date">{formatDate(game.playedAt)}</div>
          <div className="game-meta">
            <span className="badge">{profileName}</span>
            {isInvited && <span className="badge badge-warn">Invitation</span>}
            {game.status === 'in_progress' && <span className="badge">In progress</span>}
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
              {player.name}
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

  const gamesQuery = useQuery({
    queryKey: ['games'],
    queryFn: () => api<{ games: GameSummary[] }>('/api/games'),
  });
  const statsQuery = useQuery({
    queryKey: ['stats', 'me'],
    queryFn: () => api<{ stats: Stats }>('/api/stats'),
  });

  const stats = statsQuery.data?.stats;
  const games = gamesQuery.data?.games ?? [];

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Games</h1>
          <p className="muted">
            Welcome back{user?.name ? `, ${user.name.split(' ')[0]}` : ''}. Your recent Wingspan games
            and how you are doing.
          </p>
        </div>
        <Link to="/games/new" className="btn btn-primary">
          New game
        </Link>
      </div>

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

      <section>
        <div className="section-head">
          <h2>Recent games</h2>
          <Link to="/stats" className="link">
            All stats →
          </Link>
        </div>

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

        <div className="game-list">
          {games.map((game) => (
            <GameCard key={game.id} game={game} currentUserId={user?.id} />
          ))}
        </div>
      </section>
    </div>
  );
}
