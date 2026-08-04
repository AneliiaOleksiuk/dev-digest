import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type {
  ConventionRow,
  ConventionsRepository,
  InsertConvention,
  UpdateConvention,
} from './repository.js';

const NUL_CHARACTER = String.fromCharCode(0);

/** Postgres text columns reject NUL bytes outright, regardless of encoding —
 *  strip any that slipped in from LLM output or pasted content. */
function removeNulBytes(value: string): string {
  return value.split(NUL_CHARACTER).join('');
}

export class DrizzleConventionsRepository implements ConventionsRepository {
  constructor(private db: Db) {}

  async listByRepo(workspaceId: string, repoId: string): Promise<ConventionRow[]> {
    return this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.repoId, repoId)));
  }

  async getById(workspaceId: string, id: string): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)));
    return row;
  }

  async insertMany(values: InsertConvention[]): Promise<ConventionRow[]> {
    if (values.length === 0) return [];
    return this.db
      .insert(t.conventions)
      .values(
        values.map((value) => ({
          workspaceId: value.workspaceId,
          repoId: value.repoId,
          category: value.category ? removeNulBytes(value.category) : null,
          rule: removeNulBytes(value.rule),
          evidencePath: removeNulBytes(value.evidencePath),
          evidenceSnippet: removeNulBytes(value.evidenceSnippet),
          evidenceLine: value.evidenceLine ?? null,
          confidence: value.confidence,
        })),
      )
      .returning();
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateConvention,
  ): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .update(t.conventions)
      .set({
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.rule !== undefined ? { rule: removeNulBytes(patch.rule) } : {}),
        ...(patch.evidencePath !== undefined
          ? { evidencePath: removeNulBytes(patch.evidencePath) }
          : {}),
        ...(patch.evidenceSnippet !== undefined
          ? { evidenceSnippet: removeNulBytes(patch.evidenceSnippet) }
          : {}),
        ...(patch.skillId !== undefined ? { skillId: patch.skillId } : {}),
      })
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .returning();
    return row;
  }

  async deleteUnpromoted(workspaceId: string, repoId: string): Promise<void> {
    await this.db
      .delete(t.conventions)
      .where(
        and(
          eq(t.conventions.workspaceId, workspaceId),
          eq(t.conventions.repoId, repoId),
          isNull(t.conventions.skillId),
        ),
      );
  }
}
