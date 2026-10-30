import type { Workspace } from '@reaplift/shared';
import { Link } from 'react-router-dom';
import { workspacePath } from '../paths';

type WorkspacePickerProps = {
  workspaces: Workspace[];
  /** The super admin can also open Admin from here. */
  showAdmin: boolean;
};

/** Choose which client's workspace to open. Every page after this shows only that client. */
export function WorkspacePicker({ workspaces, showAdmin }: WorkspacePickerProps) {
  return (
    <div className="panel">
      <div className="panel-header">
        <h2>Choose a client</h2>
      </div>

      {workspaces.length === 0 ? (
        <p>No clients are assigned to you yet. Ask ReapLift to assign one.</p>
      ) : (
        <ul className="workspace-list">
          {workspaces.map((w) =>
            w.status === 'active' ? (
              <li key={w.clientId}>
                <Link className="workspace-item" to={workspacePath(w.clientId, 'dashboard')}>
                  {w.name}
                </Link>
              </li>
            ) : (
              <li key={w.clientId}>
                <span className="workspace-item disabled" aria-disabled="true">
                  {w.name} <span className="status-pill status-suspended">Suspended</span>
                </span>
              </li>
            ),
          )}
        </ul>
      )}

      {showAdmin && (
        <p>
          <Link className="link-button" to="/admin">
            Open Admin
          </Link>
        </p>
      )}
    </div>
  );
}
