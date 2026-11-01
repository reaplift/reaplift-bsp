import { useId, useRef, useState } from 'react';

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
  /** Offers a button that fills in a strong password and shows it, to read out to the person. */
  canGenerate?: boolean;
};

const PASSWORD_LETTERS = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** 14 characters from random bytes, leaving out letters easily confused when read out (0 and O, 1 and l). */
export function generatePassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  return Array.from(bytes, (byte) => PASSWORD_LETTERS[byte % PASSWORD_LETTERS.length]).join('');
}

/** A password input with an eye button to show what was typed. */
export function PasswordField({ label, name, autoComplete, minLength, hint, canGenerate }: PasswordFieldProps) {
  const [shown, setShown] = useState(false);
  const hintId = useId();
  const input = useRef<HTMLInputElement>(null);
  const action = shown ? 'Hide password' : 'Show password';
  return (
    <div className="field">
      <label>
        <span>{label}</span>
        <div className="password-field">
          <input
            ref={input}
            name={name}
            type={shown ? 'text' : 'password'}
            autoComplete={autoComplete}
            minLength={minLength}
            aria-describedby={hint ? hintId : undefined}
            required
          />
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
      </label>
      {canGenerate && (
        <button
          type="button"
          className="small-button field-action"
          onClick={() => {
            if (input.current) input.current.value = generatePassword();
            setShown(true);
          }}
        >
          Generate password
        </button>
      )}
      {hint && (
        <small id={hintId} className="form-note">
          {hint}
        </small>
      )}
    </div>
  );
}
