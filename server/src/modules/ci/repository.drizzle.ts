import type { Db } from '../../db/client.js';
import type { CiRepository } from './repository.js';

/**
 * The only file in `modules/ci/` allowed to import Drizzle/`db/schema`
 * (onion-architecture). Empty in Phase B — see `repository.ts`'s doc comment
 * for why the real methods are deferred to Phase C (WI12) rather than
 * guessed at here.
 */
export class DrizzleCiRepository implements CiRepository {
  constructor(private db: Db) {}
}
