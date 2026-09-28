import { Fragment } from 'react';
import {
  BLUE_GOAL_CAP,
  computeGame,
  GOAL_PLACES,
  GOAL_ROUNDS,
  goalRoundKey,
  nectarKey,
  TIEBREAK_KEY,
  type ScoringProfile,
} from '../../shared/scoring';
import type { ScoreMap } from '../../shared/types';
import { ScoreInput } from './ScoreInput';

export interface EditablePlayer {
  id: string;
  name: string;
  email?: string | null;
  userId: string | null;
  status: 'pending' | 'accepted';
  scores: ScoreMap;
}

interface ScoreSheetProps {
  profile: ScoringProfile;
  players: EditablePlayer[];
  onChange: (players: EditablePlayer[]) => void;
  readOnly?: boolean;
}

function placementOf(value: number | null | undefined): number {
  const numeric = typeof value === 'number' ? Math.round(value) : 0;
  return numeric >= 0 && numeric <= 3 ? numeric : 0;
}

export function ScoreSheet({ profile, players, onChange, readOnly = false }: ScoreSheetProps) {
  const computed = computeGame(profile, players);
  const winnerSet = new Set(computed.winners);

  function setScore(playerIndex: number, key: string, value: number | null) {
    onChange(
      players.map((player, index) =>
        index === playerIndex ? { ...player, scores: { ...player.scores, [key]: value } } : player,
      ),
    );
  }

  return (
    <div className="score-table-wrap">
      <table className="score-table">
        <thead>
          <tr>
            <th className="cat-corner" scope="col">
              Category
            </th>
            {players.map((player, index) => (
              <th key={player.id} scope="col" className={winnerSet.has(index) ? 'winner' : ''}>
                <div className="player-head">
                  <span className="player-name">
                    {player.status === 'pending'
                      ? (player.email ?? 'Invited player')
                      : player.name}
                  </span>
                  {player.status === 'pending' && <span className="badge badge-warn">invited</span>}
                  <div className="player-total-badge">
                    {winnerSet.has(index) && <span aria-label="Winner">🏆</span>}
                    <span>{computed.totals[index] ?? 0}</span>
                  </div>
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {profile.categories.map((category) => {
            if (category.kind === 'nectar' && category.habitats) {
              return (
                <Fragment key={category.id}>
                  <tr className="group-row">
                    <td colSpan={players.length + 1}>
                      <span className="group-title">{category.label}</span>
                      <span className="muted">most in each habitat: 5 pts · second: 2 pts</span>
                    </td>
                  </tr>
                  {category.habitats.map((habitat) => (
                    <tr key={habitat.id}>
                      <td className="cat-label sub">{habitat.label}</td>
                      {players.map((player, index) => (
                        <td key={player.id}>
                          <ScoreInput
                            value={player.scores[nectarKey(habitat.id)] ?? null}
                            onChange={(value) => setScore(index, nectarKey(habitat.id), value)}
                            disabled={readOnly}
                            ariaLabel={`${player.name} ${habitat.label}`}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr className="derived-row">
                    <td className="cat-label sub">Nectar points</td>
                    {players.map((player, index) => (
                      <td key={player.id} className="derived">
                        {computed.perPlayer[index]?.[category.id] ?? 0}
                      </td>
                    ))}
                  </tr>
                </Fragment>
              );
            }

            if (category.kind === 'roundGoals') {
              const blue = profile.goalBoard === 'blue';
              const places = GOAL_PLACES.filter((place) => place.value <= Math.min(3, players.length));
              return (
                <Fragment key={category.id}>
                  <tr className="group-row">
                    <td colSpan={players.length + 1}>
                      <span className="group-title">{category.label}</span>
                      <span className="muted">
                        {blue
                          ? `blue board · 1 pt per item, max ${BLUE_GOAL_CAP} per round`
                          : 'green board · 1st / 2nd / 3rd per round · ties split points'}
                      </span>
                    </td>
                  </tr>
                  {Array.from({ length: GOAL_ROUNDS }, (_, index) => index + 1).map((round) => (
                    <tr key={round}>
                      <td className="cat-label sub">
                        Round {round}
                        {blue ? ' count' : ''}
                      </td>
                      {players.map((player, index) => (
                        <td key={player.id}>
                          {blue ? (
                            <ScoreInput
                              value={player.scores[goalRoundKey(round)] ?? null}
                              onChange={(value) => setScore(index, goalRoundKey(round), value)}
                              disabled={readOnly}
                              ariaLabel={`${player.name} round ${round} count`}
                            />
                          ) : (
                            <select
                              className="placement-select"
                              aria-label={`${player.name} round ${round} placement`}
                              value={placementOf(player.scores[goalRoundKey(round)])}
                              disabled={readOnly}
                              onChange={(event) =>
                                setScore(index, goalRoundKey(round), Number(event.target.value))
                              }
                            >
                              <option value={0}>—</option>
                              {places.map((place) => (
                                <option key={place.value} value={place.value}>
                                  {place.label}
                                </option>
                              ))}
                            </select>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                  <tr className="derived-row">
                    <td className="cat-label sub">Goal points</td>
                    {players.map((player, index) => (
                      <td key={player.id} className="derived">
                        {computed.perPlayer[index]?.[category.id] ?? 0}
                      </td>
                    ))}
                  </tr>
                </Fragment>
              );
            }

            return (
              <tr key={category.id}>
                <td className="cat-label" title={category.help}>
                  {category.label}
                  {category.help && (
                    <span className="info" title={category.help} aria-hidden="true">
                      ⓘ
                    </span>
                  )}
                </td>
                {players.map((player, index) => (
                  <td key={player.id}>
                    <ScoreInput
                      value={player.scores[category.id] ?? null}
                      onChange={(value) => setScore(index, category.id, value)}
                      disabled={readOnly}
                      signed={category.kind === 'signed'}
                      ariaLabel={`${player.name} ${category.label}`}
                    />
                  </td>
                ))}
              </tr>
            );
          })}

          <tr className="tiebreak-row">
            <td className="cat-label" title="Only used to break a tie for the highest score.">
              Unused food
              <span className="info" aria-hidden="true">
                ⓘ
              </span>
            </td>
            {players.map((player, index) => (
              <td key={player.id}>
                <ScoreInput
                  value={player.scores[TIEBREAK_KEY] ?? null}
                  onChange={(value) => setScore(index, TIEBREAK_KEY, value)}
                  disabled={readOnly}
                  ariaLabel={`${player.name} unused food`}
                />
              </td>
            ))}
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td>Total</td>
            {players.map((player, index) => (
              <td key={player.id} className={winnerSet.has(index) ? 'winner' : ''}>
                {computed.totals[index] ?? 0}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
