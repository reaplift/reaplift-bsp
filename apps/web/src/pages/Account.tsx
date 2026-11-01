import { useState, type FormEvent } from 'react';
import { useAuth } from '../auth/context';
import { PasswordField } from '../components/PasswordField';
import { ErrorNote, Panel } from '../components/ui';
import { useAction } from '../hooks/useLoad';

const MIN_PASSWORD = 10;

/** Current and new password, asked twice so a typing slip cannot lock anyone out. */
function ChangePasswordForm({ onChanged }: { onChanged: () => void }) {
  const { api } = useAuth();
  const { error, busy, run } = useAction();
  const [mismatch, setMismatch] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const newPassword = String(data.get('newPassword'));
    setMismatch(newPassword !== String(data.get('repeat')));
    if (newPassword !== String(data.get('repeat'))) return;
    const done = await run(() => api.changePassword({ currentPassword: String(data.get('currentPassword')), newPassword }));
    if (done) {
      form.reset();
      onChanged();
    }
  };

  return (
    <form className="form-grid" onSubmit={submit}>
      <PasswordField label="Current password" name="currentPassword" autoComplete="current-password" />
      <PasswordField
        label="New password"
        name="newPassword"
        autoComplete="new-password"
        minLength={MIN_PASSWORD}
        hint={`At least ${MIN_PASSWORD} characters, different from your current password. Letters, numbers and symbols are all allowed.`}
      />
      <PasswordField label="Repeat new password" name="repeat" autoComplete="new-password" minLength={MIN_PASSWORD} />
      {mismatch && <ErrorNote message="The two new passwords do not match." />}
      <ErrorNote message={error} />
      <div className="form-actions">
        <button type="submit" className="primary-button" disabled={busy}>
          Change password
        </button>
      </div>
    </form>
  );
}

export function MyAccount() {
  const { state } = useAuth();
  const [changed, setChanged] = useState(false);
  const user = state.status === 'logged-in' ? state.user : null;
  return (
    <div className="page-stack">
      <Panel title="My account">
        <p>
          {user?.name}
          <br />
          <span className="form-note">{user?.email}</span>
        </p>
      </Panel>
      <Panel title="Change password">
        {changed && <p className="form-success">Your password is changed. Other devices are logged out.</p>}
        <ChangePasswordForm onChanged={() => setChanged(true)} />
      </Panel>
    </div>
  );
}

/** Shown instead of everything else while a first password is in use. */
export function ForcedPasswordChange() {
  const { reload, logout } = useAuth();
  return (
    <div className="auth-panel panel">
      <h2>Choose a new password</h2>
      <p className="form-note">You are using a first password set by ReapLift. Choose your own to continue.</p>
      <ChangePasswordForm onChanged={reload} />
      <p>
        <button type="button" className="link-button" onClick={() => void logout()}>
          Log out
        </button>
      </p>
    </div>
  );
}
