import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { deriveProfile, normalizeConfig, SELECTABLE_EXPANSIONS } from '../../shared/scoring';
import type { GameSummary, GoalBoard, Stats } from '../../shared/types';
import { formatDate } from '../lib/format';

interface PlayedWith {
  id: string;
  name: string;
  picture: string | null;
  games: number;
}

function profileLabel(game: GameSummary): string {
  return deriveProfile(
    normalizeConfig({
      coreSets: game.coreSets,
      expansions: game.expansions,
      goalBoard: game.goalBoard,
    }),
  ).name;
}

export function StatsPage() {
  const { user } = useAuth();
  const [subjectId, setSubjectId] = useState<string>('me');
  const [selectedExpansions, setSelectedExpansions] = useState<string[]>([]);
  const [goalBoard, setGoalBoard] = useState<'all' | GoalBoard>('all');

  const playersQuery = useQuery({
    queryKey: ['players'],
    queryFn: () => api<{ players: PlayedWith[] }>('/api/stats/players'),
    enabled: Boolean(user),
  });

  const statsQuery = useQuery({
    queryKey: ['stats', subjectId, selectedExpansions, goalBoard],
    queryFn: () => {
      const params = new URLSearchParams();
      if (subjectId !== 'me') params.set('userId', subjectId);
      if (selectedExpansions.length) params.set('expansions', selectedExpansions.join(','));
      if (goalBoard !== 'all') params.set('goalBoard', goalBoard);
      const query = params.toString();
      return api<{ stats: Stats }>(`/api/stats${query ? `?${query}` : ''}`);
    },
    enabled: Boolean(user),
  });

  function toggleExpansion(expansionId: string) {
    setSelectedExpansions((prev) =>
      prev.includes(expansionId)
        ? prev.filter((value) => value !== expansionId)
        : [...prev, expansionId],
    );
  }

  const stats = statsQuery.data?.stats;
  const players = playersQuery.data?.players ?? [];
  const friendIds = new Set(players.map((player) => player.id));
  const maxCategory = Math.max(1, ...(stats?.categoryAverages.map((item) => item.average) ?? [1]));

  if (!user) {
    return (
      <div className="stack">
        <div className="page-head">
          <div>
            <h1>Statistics</h1>
            <p className="muted">Sign in to track stats across games and devices.</p>
          </div>
        </div>
        <div className="card empty-state">
          <h2>Stats need an account</h2>
          <p className="muted">
            Local games are saved on this device. Sign in to keep stats across games and see how you
            do against the people you play with.
          </p>
          <Link to="/login" className="btn btn-primary">
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Statistics</h1>
          <p className="muted">
            {stats?.subject && subjectId !== 'me'
              ? `${stats.subject.name}’s games. You can only view players you’ve played with.`
              : 'Your games across every expansion and game size.'}
          </p>
        </div>
        <label className="field inline">
          <span className="sr-only">Player</span>
          <select
            className="filter-select"
            value={subjectId}
            onChange={(event) => setSubjectId(event.target.value)}
          >
            <option value="me">Me{user?.name ? ` — ${user.name}` : ''}</option>
            {players.map((player) => (
              <option key={player.id} value={player.id}>
                {player.name} ({player.games})
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="card stack-sm">
        <div className="setup-row">
          <span className="setup-label">Expansions</span>
          <div className="chip-list">
            <button
              type="button"
              className={`chip${selectedExpansions.length === 0 ? ' chip-on' : ''}`}
              onClick={() => setSelectedExpansions([])}
            >
              Any
            </button>
            {SELECTABLE_EXPANSIONS.map((expansion) => (
              <button
                key={expansion.id}
                type="button"
                className={`chip${selectedExpansions.includes(expansion.id) ? ' chip-on' : ''}`}
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
            {(['all', 'green', 'blue'] as const).map((board) => (
              <button
                key={board}
                type="button"
                className={goalBoard === board ? 'active' : ''}
                onClick={() => setGoalBoard(board)}
              >
                {board === 'all' ? 'All' : board === 'green' ? 'Green' : 'Blue'}
              </button>
            ))}
          </div>
        </div>
        {selectedExpansions.length > 1 && (
          <p className="fine-print">Showing games that include all selected expansions.</p>
        )}
      </div>

      {statsQuery.isLoading && <p className="muted">Loading stats…</p>}
      {statsQuery.isError && (
        <p className="alert alert-error">Could not load stats for that player.</p>
      )}

      {stats && stats.totals.completed === 0 && (
        <p className="muted">No completed games match these filters.</p>
      )}

      {stats && (
        <>
          <section className="stat-grid">
            <div className="stat-card card">
              <span className="stat-label">Games played</span>
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
              <h2>By game setup</h2>
              {stats.byProfile.length === 0 ? (
                <p className="muted">—</p>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Setup</th>
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

          {stats.rivals.length > 0 && (
            <section className="card">
              <h2>Friends</h2>
              <p className="muted">
                Everyone you’ve played a game with, and your head-to-head record. Linked players
                only — guests aren’t tracked here.
              </p>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Friend</th>
                    <th>Games</th>
                    <th>You</th>
                    <th>Them</th>
                    <th>Your avg</th>
                    <th>Their avg</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.rivals.map((rival) => {
                    const isFriend = rival.userId ? friendIds.has(rival.userId) : false;
                    return (
                      <tr key={rival.userId ?? rival.name}>
                        <td>
                          {isFriend && rival.userId !== subjectId ? (
                            <button
                              type="button"
                              className="link"
                              onClick={() => setSubjectId(rival.userId as string)}
                            >
                              {rival.name}
                            </button>
                          ) : (
                            rival.name
                          )}
                        </td>
                        <td>{rival.gamesTogether}</td>
                        <td>{rival.myWins}</td>
                        <td>{rival.theirWins}</td>
                        <td>{rival.myAverage}</td>
                        <td>{rival.theirAverage}</td>
                      </tr>
                    );
                  })}
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
                      <span className="muted">{profileLabel(game)}</span>
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
