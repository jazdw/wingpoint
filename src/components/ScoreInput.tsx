interface ScoreInputProps {
  value: number | null;
  onChange: (value: number | null) => void;
  disabled?: boolean;
  ariaLabel?: string;
  /** Allow negative values (e.g. the hummingbird track). */
  signed?: boolean;
}

export function ScoreInput({
  value,
  onChange,
  disabled,
  ariaLabel,
  signed = false,
}: ScoreInputProps) {
  const current = value ?? 0;

  return (
    <div className={`score-input${signed ? ' score-input-signed' : ''}`}>
      <button
        type="button"
        className="step"
        onClick={() => onChange(signed ? current - 1 : Math.max(0, current - 1))}
        disabled={disabled || (!signed && current <= 0)}
        aria-label={`Decrease ${ariaLabel ?? 'score'}`}
      >
        −
      </button>
      <input
        type="text"
        inputMode={signed ? 'text' : 'numeric'}
        value={value === null || value === undefined ? '' : String(value)}
        aria-label={ariaLabel}
        disabled={disabled}
        onFocus={(event) => event.currentTarget.select()}
        onChange={(event) => {
          let text = event.currentTarget.value.replace(signed ? /[^0-9-]/g : /[^0-9]/g, '');
          if (signed) text = text.replace(/(?!^)-/g, '');
          onChange(text === '' || text === '-' ? null : Number(text));
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
