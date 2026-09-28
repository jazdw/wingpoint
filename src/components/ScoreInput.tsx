interface ScoreInputProps {
  value: number | null;
  onChange: (value: number | null) => void;
  disabled?: boolean;
  ariaLabel?: string;
}

export function ScoreInput({ value, onChange, disabled, ariaLabel }: ScoreInputProps) {
  const current = value ?? 0;

  return (
    <div className="score-input">
      <button
        type="button"
        className="step"
        onClick={() => onChange(Math.max(0, current - 1))}
        disabled={disabled || current <= 0}
        aria-label={`Decrease ${ariaLabel ?? 'score'}`}
      >
        −
      </button>
      <input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        value={value === null || value === undefined ? '' : String(value)}
        aria-label={ariaLabel}
        disabled={disabled}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => {
          const digits = event.currentTarget.value.replace(/[^0-9]/g, '');
          onChange(digits === '' ? null : Number(digits));
        }}
      />
      <button
        type="button"
        className="step"
        onClick={() => onChange(current + 1)}
        disabled={disabled}
        aria-label={`Increase ${ariaLabel ?? 'score'}`}
      >
        +
      </button>
    </div>
  );
}
