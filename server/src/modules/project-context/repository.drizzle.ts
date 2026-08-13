import { and, asc, eq, ne } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type {
  ContextAttachmentRow,
  ContextRepository,
  ContextRepoRow,
  ContextSurface,
  EffectiveAttachmentRow,
} from './repository.js';

export class DrizzleContextRepository implements ContextRepository {
  constructor(private db: Db) {}

  async getRepo(workspaceId: string, repoId: string): Promise<ContextRepoRow | undefined> {
    const [row] = await this.db
      .select({ id: t.repos.id, clonePath: t.repos.clonePath })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }

  async listFor(
    workspaceId: string,
    surface: ContextSurface,
    surfaceId: string,
    repoId: string,
  ): Promise<ContextAttachmentRow[]> {
    const rows = await this.db
      .select({ path: t.projectContextAttachments.path, order: t.projectContextAttachments.order })
      .from(t.projectContextAttachments)
      .where(
        and(
          eq(t.projectContextAttachments.workspaceId, workspaceId),
          eq(t.projectContextAttachments.surface, surface),
          eq(t.projectContextAttachments.surfaceId, surfaceId),
          eq(t.projectContextAttachments.repoId, repoId),
        ),
      )
      .orderBy(asc(t.projectContextAttachments.order));
    return rows;
  }

  async listForAll(
    workspaceId: string,
    surface: ContextSurface,
    surfaceId: string,
  ): Promise<{ path: string; order: number; repoId: string }[]> {
    const rows = await this.db
      .select({
        path: t.projectContextAttachments.path,
        order: t.projectContextAttachments.order,
        repoId: t.projectContextAttachments.repoId,
      })
      .from(t.projectContextAttachments)
      .where(
        and(
          eq(t.projectContextAttachments.workspaceId, workspaceId),
          eq(t.projectContextAttachments.surface, surface),
          eq(t.projectContextAttachments.surfaceId, surfaceId),
        ),
      )
      .orderBy(asc(t.projectContextAttachments.repoId), asc(t.projectContextAttachments.order));
    return rows;
  }

  async replaceFor(
    workspaceId: string,
    surface: ContextSurface,
    surfaceId: string,
    repoId: string,
    paths: string[],
  ): Promise<ContextAttachmentRow[]> {
    // Repo-scoped replace: an agent/skill may hold attachments against
    // several repos at once (E-8); only THIS repo's rows are replaced.
    await this.db
      .delete(t.projectContextAttachments)
      .where(
        and(
          eq(t.projectContextAttachments.workspaceId, workspaceId),
          eq(t.projectContextAttachments.surface, surface),
          eq(t.projectContextAttachments.surfaceId, surfaceId),
          eq(t.projectContextAttachments.repoId, repoId),
        ),
      );
    if (paths.length === 0) return [];
    await this.db.insert(t.projectContextAttachments).values(
      paths.map((path, order) => ({
        workspaceId,
        repoId,
        surface,
        surfaceId,
        path,
        order,
      })),
    );
    return paths.map((path, order) => ({ path, order }));
  }

  async listForAgentEffective(
    workspaceId: string,
    agentId: string,
    repoId: string,
  ): Promise<EffectiveAttachmentRow[]> {
    const direct = await this.db
      .select({ path: t.projectContextAttachments.path, order: t.projectContextAttachments.order })
      .from(t.projectContextAttachments)
      .where(
        and(
          eq(t.projectContextAttachments.workspaceId, workspaceId),
          eq(t.projectContextAttachments.surface, 'agent'),
          eq(t.projectContextAttachments.surfaceId, agentId),
          eq(t.projectContextAttachments.repoId, repoId),
        ),
      );

    // enabled-linked-skill attachments — mirrors the enabled-only rule at
    // run-executor.ts:228-229 ("linking ≠ trusting").
    const viaSkills = await this.db
      .select({
        path: t.projectContextAttachments.path,
        order: t.projectContextAttachments.order,
        skillName: t.skills.name,
      })
      .from(t.agentSkills)
      .innerJoin(t.skills, eq(t.agentSkills.skillId, t.skills.id))
      .innerJoin(
        t.projectContextAttachments,
        and(
          eq(t.projectContextAttachments.surface, 'skill'),
          eq(t.projectContextAttachments.surfaceId, t.skills.id),
          eq(t.projectContextAttachments.repoId, repoId),
        ),
      )
      .where(
        and(
          eq(t.agentSkills.agentId, agentId),
          eq(t.skills.enabled, true),
          eq(t.projectContextAttachments.workspaceId, workspaceId),
        ),
      );

    const rows: EffectiveAttachmentRow[] = [
      ...direct.map((r) => ({
        path: r.path,
        order: r.order,
        source: 'agent' as const,
        enabled: true,
      })),
      ...viaSkills.map((r) => ({
        path: r.path,
        order: r.order,
        source: 'skill' as const,
        skillName: r.skillName,
        enabled: true,
      })),
    ];
    return rows;
  }

  async listMismatchedForAgent(
    workspaceId: string,
    agentId: string,
    repoId: string,
  ): Promise<{ path: string; repoId: string }[]> {
    const direct = await this.db
      .select({
        path: t.projectContextAttachments.path,
        repoId: t.projectContextAttachments.repoId,
      })
      .from(t.projectContextAttachments)
      .where(
        and(
          eq(t.projectContextAttachments.workspaceId, workspaceId),
          eq(t.projectContextAttachments.surface, 'agent'),
          eq(t.projectContextAttachments.surfaceId, agentId),
          ne(t.projectContextAttachments.repoId, repoId),
        ),
      );

    const viaSkills = await this.db
      .select({
        path: t.projectContextAttachments.path,
        repoId: t.projectContextAttachments.repoId,
      })
      .from(t.agentSkills)
      .innerJoin(t.skills, eq(t.agentSkills.skillId, t.skills.id))
      .innerJoin(
        t.projectContextAttachments,
        and(
          eq(t.projectContextAttachments.surface, 'skill'),
          eq(t.projectContextAttachments.surfaceId, t.skills.id),
          ne(t.projectContextAttachments.repoId, repoId),
        ),
      )
      .where(
        and(
          eq(t.agentSkills.agentId, agentId),
          eq(t.skills.enabled, true),
          eq(t.projectContextAttachments.workspaceId, workspaceId),
        ),
      );

    return [...direct, ...viaSkills];
  }

  async usageCountsByPath(workspaceId: string, repoId: string): Promise<Map<string, number>> {
    const direct = await this.db
      .select({ path: t.projectContextAttachments.path, agentId: t.projectContextAttachments.surfaceId })
      .from(t.projectContextAttachments)
      .where(
        and(
          eq(t.projectContextAttachments.workspaceId, workspaceId),
          eq(t.projectContextAttachments.surface, 'agent'),
          eq(t.projectContextAttachments.repoId, repoId),
        ),
      );

    const viaSkills = await this.db
      .select({ path: t.projectContextAttachments.path, agentId: t.agentSkills.agentId })
      .from(t.projectContextAttachments)
      .innerJoin(t.skills, eq(t.projectContextAttachments.surfaceId, t.skills.id))
      .innerJoin(t.agentSkills, eq(t.agentSkills.skillId, t.skills.id))
      .where(
        and(
          eq(t.projectContextAttachments.workspaceId, workspaceId),
          eq(t.projectContextAttachments.surface, 'skill'),
          eq(t.projectContextAttachments.repoId, repoId),
          eq(t.skills.enabled, true),
        ),
      );

    // Distinct agent id per path across both sources (AC-8: a document
    // attached both directly and via a skill still counts that agent once).
    const byPath = new Map<string, Set<string>>();
    for (const { path, agentId } of [...direct, ...viaSkills]) {
      const set = byPath.get(path) ?? new Set<string>();
      set.add(agentId);
      byPath.set(path, set);
    }
    const counts = new Map<string, number>();
    for (const [path, agentIds] of byPath) counts.set(path, agentIds.size);
    return counts;
  }

  async distinctAttachedPaths(workspaceId: string, repoId: string): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ path: t.projectContextAttachments.path })
      .from(t.projectContextAttachments)
      .where(
        and(
          eq(t.projectContextAttachments.workspaceId, workspaceId),
          eq(t.projectContextAttachments.repoId, repoId),
        ),
      );
    return rows.map((r) => r.path);
  }

  async deleteForSurface(
    workspaceId: string,
    surface: ContextSurface,
    surfaceId: string,
  ): Promise<void> {
    await this.db
      .delete(t.projectContextAttachments)
      .where(
        and(
          eq(t.projectContextAttachments.workspaceId, workspaceId),
          eq(t.projectContextAttachments.surface, surface),
          eq(t.projectContextAttachments.surfaceId, surfaceId),
        ),
      );
  }
}
