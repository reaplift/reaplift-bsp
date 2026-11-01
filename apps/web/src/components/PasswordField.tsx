import { useState } from 'react';

function EyeIcon({ crossed }: { crossed: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {crossed && <line x1="3" y1="3" x2="21" y2="21" />}
    </svg>
  );
}

type PasswordFieldProps = {
  label: string;
  name: string;
  autoComplete: string;
  minLength?: number;
  /** A rule to show under the field, so nobody has to fail first to learn it. */
  hint?: string;
};

/** A password input with an eye button to show what was typed. */
export function PasswordField({ label, name, autoComplete, minLength, hint }: PasswordFieldProps) {
  const [shown, setShown] = useState(false);
  const action = shown ? 'Hide password' : 'Show password';
  return (
    <label>
      <span>{label}</span>
      <div className="password-field">
        <input name={name} type={shown ? 'text' : 'password'} autoComplete={autoComplete} minLength={minLength} required />
        <button
          type="button"
          className="password-toggle"
          onClick={() => setShown((value) => !value)}
          aria-label={action}
          aria-pressed={shown}
          title={action}
        >
          <EyeIcon crossed={shown} />
        </button>
      </div>
      {hint && <small className="form-note">{hint}</small>}
    </label>
  );
}
