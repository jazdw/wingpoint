import { Fragment } from 'react';
import {
  BLUE_GOAL_CAP,
  computeGame,
  computeGoalRound,
  GOAL_PLACES,
  GOAL_ROUNDS,
  goalMovedKey,
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
  /** Friends of the viewer: their names are shown even while pending. */
  knownUserIds?: Set<string>;
  /** `playerIndex:scoreKey` entries to highlight as invalid. */
  invalidFields?: Set<string>;
  readOnly?: boolean;
}

export function ScoreSheet({
  profile,
  players,
  onChange,
  knownUserIds,
  invalidFields,
  readOnly = false,
}: ScoreSheetProps) {
  const computed = computeGame(profile, players);
  const winnerSet = new Set(computed.winners);
  // Place and points per round (ties already split), shown next to each input.
  const rounds = Array.from({ length: GOAL_ROUNDS }, (_, index) => {
    const round = index + 1;
    return computeGoalRound(
      profile.goalBoard,
      round,
      players.map((player) => player.scores[goalRoundKey(round)]),
      round === profile.hummingbirdGoalRound
        ? players.map((player) => player.scores[goalMovedKey(round)])
        : undefined,
    );
  });
  // Unused food only matters when the highest totals are tied.
  const best = Math.max(0, ...computed.totals);
  const showTiebreak =
    best > 0 && computed.totals.filter((total) => total === best).length > 1;

  const isInvalid = (playerIndex: number, key: string) =>
    invalidFields?.has(`${playerIndex}:${key}`) ?? false;

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
                    {player.status === 'pending' &&
                    !(player.userId && knownUserIds?.has(player.userId))
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
                    <td className="group-cell">
                      <span className="group-title">{category.label}</span>
                    </td>
                    <td className="group-fill" colSpan={players.length}>
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
                            invalid={isInvalid(index, nectarKey(habitat.id))}
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
              return (
                <Fragment key={category.id}>
                  <tr className="group-row">
                    <td className="group-cell">
                      <span className="group-title">{category.label}</span>
                    </td>
                    <td className="group-fill" colSpan={players.length}>
                      <span className="muted">
                        {blue
                          ? `items each round · 1 pt each, max ${BLUE_GOAL_CAP}`
                          : 'items each round · most wins'}
                      </span>
                    </td>
                  </tr>
                  {Array.from({ length: GOAL_ROUNDS }, (_, index) => index + 1).map((round) => (
                    <tr key={round}>
                      <td
                        className="cat-label sub"
                        title={
                          round === profile.hummingbirdGoalRound
                            ? 'Hummingbird points: enter each player’s track points (may be 0 or negative) and tick if they moved up the track at least once — only they can place.'
                            : undefined
                        }
                      >
                        Round {round}
                        {round === profile.hummingbirdGoalRound && (
                          <span className="round-goal-name">Hummingbird pts</span>
                        )}
                      </td>
                      {players.map((player, index) => {
                        const key = goalRoundKey(round);
                        const hummingbird = round === profile.hummingbirdGoalRound;
                        const movedKey = goalMovedKey(round);
                        const place = rounds[round - 1].places[index];
                        const points = rounds[round - 1].points[index];
                        const placeLabel = GOAL_PLACES.find((item) => item.value === place)?.label;
                        return (
                          <td key={player.id}>
                            <div className="placement-cell">
                              <ScoreInput
                                value={player.scores[key] ?? null}
                                onChange={(value) => setScore(index, key, value)}
                                disabled={readOnly}
                                signed={hummingbird}
                                invalid={isInvalid(index, key)}
                                ariaLabel={`${player.name} round ${round} goal ${
                                  hummingbird ? 'hummingbird points' : 'count'
                                }`}
                              />
                              {hummingbird && (
                                <label className="moved-toggle">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(player.scores[movedKey])}
                                    disabled={readOnly}
                                    onChange={(event) =>
                                      setScore(index, movedKey, event.target.checked ? 1 : 0)
                                    }
                                  />
                                  moved up
                                </label>
                              )}
                              <span className="placement-points">
                                {placeLabel && <span className="placement-place">{placeLabel}</span>}
                                {points} {points === 1 ? 'pt' : 'pts'}
                              </span>
                            </div>
                          </td>
                        );
                      })}
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
                      invalid={isInvalid(index, category.id)}
                      ariaLabel={`${player.name} ${category.label}`}
                    />
                  </td>
                ))}
              </tr>
            );
          })}

          {showTiebreak && (
          <tr className="tiebreak-row">
            <td className="cat-label" title="Breaks a tie for the highest score.">
              Unused food (tie-break)
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
                  invalid={isInvalid(index, TIEBREAK_KEY)}
                  ariaLabel={`${player.name} unused food`}
                />
              </td>
            ))}
          </tr>
          )}
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
