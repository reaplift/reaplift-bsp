import type { MeResponse } from '@reaplift/shared';

/** The pages inside a client's workspace. */
export type WorkspacePage = 'dashboard' | 'campaign';

/** `/clients/<id>/<page>`: the client is in the address, like the server's own routes. */
export const workspacePath = (clientId: string, page: WorkspacePage) =>
  `/clients/${encodeURIComponent(clientId)}/${page}`;

/**
 * Where a logged-in user starts. One workspace opens directly; several, none, or a super admin
 * (who may want Admin instead) start at the picker.
 */
export function homePath({ user, workspaces }: MeResponse): string {
  const only = workspaces.length === 1 ? workspaces[0] : undefined;
  if (user.role !== 'super_admin' && only?.status === 'active') return workspacePath(only.clientId, 'dashboard');
  return '/workspaces';
}
