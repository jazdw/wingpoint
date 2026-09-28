import { Fragment } from 'react';
import { computeGame, getProfile, nectarKey, TIEBREAK_KEY } from '../../shared/scoring';
import type { ScoreMap } from '../../shared/types';
import { ScoreInput } from './ScoreInput';

export interface EditablePlayer {
  id: string;
  name: string;
  userId: string | null;
  scores: ScoreMap;
}

interface ScoreSheetProps {
  profileId: string;
  players: EditablePlayer[];
  onChange: (players: EditablePlayer[]) => void;
  onRemovePlayer?: (index: number) => void;
  readOnly?: boolean;
}

export function ScoreSheet({
  profileId,
  players,
  onChange,
  onRemovePlayer,
  readOnly = false,
}: ScoreSheetProps) {
  const profile = getProfile(profileId);
  const computed = computeGame(profileId, players);
  const winnerSet = new Set(computed.winners);

  function setScore(playerIndex: number, key: string, value: number | null) {
    onChange(
      players.map((player, index) =>
        index === playerIndex ? { ...player, scores: { ...player.scores, [key]: value } } : player,
      ),
    );
  }

  function renamePlayer(playerIndex: number, name: string) {
    onChange(players.map((player, index) => (index === playerIndex ? { ...player, name } : player)));
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
                  {readOnly ? (
                    <span className="player-name">{player.name}</span>
                  ) : (
                    <input
                      className="player-name-input"
                      value={player.name}
                      aria-label={`Player ${index + 1} name`}
                      onChange={(event) => renamePlayer(index, event.target.value.slice(0, 40))}
                      onFocus={(event) => event.currentTarget.select()}
                    />
                  )}
                  <div className="player-total-badge">
                    {winnerSet.has(index) && <span aria-label="Winner">🏆</span>}
                    <span>{computed.totals[index] ?? 0}</span>
                  </div>
                  {!readOnly && onRemovePlayer && players.length > 1 && (
                    <button
                      type="button"
                      className="remove-player"
                      onClick={() => onRemovePlayer(index)}
                      aria-label={`Remove ${player.name}`}
                    >
                      ×
                    </button>
                  )}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {profile.categories.map((category) =>
            category.kind === 'nectar' && category.habitats ? (
              <Fragment key={category.id}>
                <tr className="group-row">
                  <td colSpan={players.length + 1}>
                    <span className="group-title">{category.label}</span>
                    <span className="muted">most in each habitat: 5 pts · second: 2 pts (3+ players)</span>
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
            ) : (
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
                      ariaLabel={`${player.name} ${category.label}`}
                    />
                  </td>
                ))}
              </tr>
            ),
          )}
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
