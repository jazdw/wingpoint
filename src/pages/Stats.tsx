import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { getProfile } from '../../shared/scoring';
import type { Stats } from '../../shared/types';
import { formatDate } from '../lib/format';

type Scope = 'me' | 'group';

export function StatsPage() {
  const [scope, setScope] = useState<Scope>('me');
  const statsQuery = useQuery({
    queryKey: ['stats', scope],
    queryFn: () => api<{ stats: Stats }>(`/api/stats?scope=${scope}`),
  });
  const stats = statsQuery.data?.stats;
  const maxCategory = Math.max(1, ...(stats?.categoryAverages.map((item) => item.average) ?? [1]));

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Statistics</h1>
          <p className="muted">How your games are going, across all the expansions.</p>
        </div>
        <div className="segmented" role="tablist" aria-label="Stats scope">
          <button
            type="button"
            className={scope === 'me' ? 'active' : ''}
            onClick={() => setScope('me')}
          >
            My stats
          </button>
          <button
            type="button"
            className={scope === 'group' ? 'active' : ''}
            onClick={() => setScope('group')}
          >
            Group
          </button>
        </div>
      </div>

      {statsQuery.isLoading && <p className="muted">Loading stats…</p>}
      {statsQuery.isError && <p className="alert alert-error">Could not load stats.</p>}

      {stats && (
        <>
          <section className="stat-grid">
            <div className="stat-card card">
              <span className="stat-label">Completed games</span>
              <span className="stat-value">{stats.totals.completed}</span>
            </div>
            <div className="stat-card card">
              <span className="stat-label">Wins</span>
              <span className="stat-value">{stats.totals.wins}</span>
            </div>
            <div className="stat-card card">
              <span className="stat-label">Win rate</span>
              <span className="stat-value">{Math.round(stats.totals.winRate * 100)}%</span>
            </div>
            <div className="stat-card card">
              <span className="stat-label">Average</span>
              <span className="stat-value">{stats.totals.averageScore}</span>
            </div>
            <div className="stat-card card">
              <span className="stat-label">Best</span>
              <span className="stat-value">{stats.totals.bestScore}</span>
            </div>
          </section>

          <section className="card">
            <h2>Average points by category</h2>
            {stats.categoryAverages.length === 0 ? (
              <p className="muted">No completed games yet.</p>
            ) : (
              <ul className="bars">
                {stats.categoryAverages.map((item) => (
                  <li key={item.id}>
                    <span className="bar-label">{item.label}</span>
                    <span className="bar-track">
                      <span className="bar-fill" style={{ width: `${(item.average / maxCategory) * 100}%` }} />
                    </span>
                    <span className="bar-value">{item.average}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="two-col">
            <section className="card">
              <h2>By player count</h2>
              {stats.byPlayerCount.length === 0 ? (
                <p className="muted">—</p>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Players</th>
                      <th>Games</th>
                      <th>Avg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.byPlayerCount.map((row) => (
                      <tr key={row.playerCount}>
                        <td>{row.playerCount}</td>
                        <td>{row.games}</td>
                        <td>{row.averageScore}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section className="card">
              <h2>By scoring profile</h2>
              {stats.byProfile.length === 0 ? (
                <p className="muted">—</p>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Profile</th>
                      <th>Games</th>
                      <th>Avg</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.byProfile.map((row) => (
                      <tr key={row.profile}>
                        <td>{row.name}</td>
                        <td>{row.games}</td>
                        <td>{row.averageScore}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </div>

          {scope === 'me' && stats.rivals.length > 0 && (
            <section className="card">
              <h2>Head to head</h2>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Opponent</th>
                    <th>Games</th>
                    <th>My wins</th>
                    <th>Their wins</th>
                    <th>My avg</th>
                    <th>Their avg</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.rivals.map((rival) => (
                    <tr key={rival.userId ?? rival.name}>
                      <td>{rival.name}</td>
                      <td>{rival.gamesTogether}</td>
                      <td>{rival.myWins}</td>
                      <td>{rival.theirWins}</td>
                      <td>{rival.myAverage}</td>
                      <td>{rival.theirAverage}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          <section className="card">
            <h2>Recent games</h2>
            {stats.recent.length === 0 ? (
              <p className="muted">—</p>
            ) : (
              <ul className="recent-list">
                {stats.recent.map((game) => (
                  <li key={game.id}>
                    <Link to={`/games/${game.id}`}>
                      <span>{formatDate(game.playedAt)}</span>
                      <span className="muted">{getProfile(game.scoringProfile).name}</span>
                      <span className="muted">
                        {game.players.map((player) => `${player.name} ${player.total}`).join(' · ')}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
