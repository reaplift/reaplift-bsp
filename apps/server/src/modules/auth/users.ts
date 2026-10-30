import { sql, type Kysely } from 'kysely';
import { USER_ROLES, type UserRole } from '@reaplift/shared';
import type { Database } from '../../lib/db.js';
import { hashPassword } from '../../lib/auth.js';

export const MIN_PASSWORD_LENGTH = 10;

export interface CreateUserInput {
  email: string;
  name: string;
  role: UserRole;
  /** Required for `client` users; must be absent for `super_admin` and `staff`. */
  clientId?: string | null;
  password: string;
}

export class UserInputError extends Error {}

/** Creates a user with an argon2id password hash. The plain password is never stored or logged. */
export async function createUser(
  db: Kysely<Database>,
  input: CreateUserInput,
): Promise<{ id: string }> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim();

  if (!USER_ROLES.includes(input.role))
    throw new UserInputError(`role must be one of ${USER_ROLES.join(', ')}`);
  if (!email.includes('@')) throw new UserInputError('email is not valid');
  if (!name) throw new UserInputError('name is required');
  if (input.role === 'client' && !input.clientId)
    throw new UserInputError('a client user needs a client');
  if (input.role !== 'client' && input.clientId)
    throw new UserInputError(`a ${input.role} user cannot have a client`);
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    throw new UserInputError(`password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }

  const passwordHash = await hashPassword(input.password);
  try {
    const result = await sql<{ id: string }>`
      insert into users (client_id, name, email, password_hash, role)
      values (${input.clientId ?? null}, ${name}, ${email}, ${passwordHash}, ${input.role})
      returning id
    `.execute(db);
    return { id: result.rows[0]!.id };
  } catch (err) {
    if ((err as { code?: string }).code === '23505')
      throw new UserInputError(`${email} already has a login`);
    throw err;
  }
}
