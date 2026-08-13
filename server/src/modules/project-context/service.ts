import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  ContextAttachmentSet,
  ContextDocument,
  ContextListing,
  ContextWriteResult,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { ConflictError, NotFoundError, ValidationError } from '../../platform/errors.js';
import { isInsideClone } from '../reviews/intent-inputs.js';
import { discoverDocuments } from './discover.js';
import { buildEntryText, docType, readUtf8OrNull, revisionOf, truncateText } from './helpers.js';
import type { ContextRepository, ContextSurface } from './repository.js';
import { assertContentWithinCap, resolveWritablePath } from './write-guards.js';
import { MAX_DOC_CHARS, PROJECT_CONTEXT_TOKEN_BUDGET } from './constants.js';

export interface WriteLogger {
  info: (obj: unknown, msg?: string) => void;
}

export interface EffectiveDocEntry {
  path: string;
  /** Path-prefixed, `wrapUntrusted`-ready text (AC-19). */
  text: string;
  tokens: number;
  chars: number;
}

export interface EffectiveSetResult {
  entries: EffectiveDocEntry[];
  /** Paths that could not be read at run time (deleted/unreadable/binary/
   *  whitespace-only) — AC-20, E-2, E-4, E-5. */
  skipped: string[];
  /** Paths that fit in persisted order but were cut by the token budget
   *  (AC-22) — a contiguous tail of the ordered candidate list. */
  truncated: string[];
  /** Attachment paths belonging to other repos of the same workspace
   *  (E-8). Never injected; logged one-line-per-path by the run-executor. */
  mismatched: string[];
}

/**
 * Project Context (SPEC-01) service — composes discovery + the tokenizer
 * port + the attachment repository into the read/write/resolve surface.
 * Onion-architecture application layer: depends on `ContextRepository`
 * (port) and `Container` (for `tokenizer`/`config`), never on `db/client.ts`
 * directly.
 */
export class ProjectContextService {
  constructor(
    private repo: ContextRepository,
    private container: Container,
  ) {}

  /** GET /repos/:repoId/context — every discovered `.md` document, plus any
   *  attached-but-deleted-from-disk path shown as `missing: true` (E-2).
   *  Throws `NotFoundError` when the repo is missing from the workspace.
   *  Degrades to an empty listing (never an error) when the repo has no
   *  local clone (AC-3/E-1). */
  async listDocuments(workspaceId: string, repoId: string): Promise<ContextListing> {
    const repoRow = await this.repo.getRepo(workspaceId, repoId);
    if (!repoRow) {
      throw new NotFoundError('Repo not found');
    }
    if (!repoRow.clonePath) {
      return {
        documents: [],
        total_tokens: 0,
        total_files: 0,
        degraded_reason:
          'This repo has no local clone yet — documents cannot be listed until it is cloned.',
        roots: this.container.config.projectContextRoots,
      };
    }
    const clonePath = repoRow.clonePath;

    const [{ documents }, usageCounts, attachedPaths] = await Promise.all([
      discoverDocuments(clonePath, this.container.config.projectContextRoots),
      this.repo.usageCountsByPath(workspaceId, repoId),
      this.repo.distinctAttachedPaths(workspaceId, repoId),
    ]);

    const discoveredPaths = new Set(documents.map((d) => d.path));
    let total_tokens = 0;
    const out: ContextDocument[] = [];

    for (const doc of documents) {
      const abs = isInsideClone(clonePath, doc.path);
      const text = abs ? await readFile(abs, 'utf8').catch(() => '') : '';
      const tokens = this.container.tokenizer.count(text);
      total_tokens += tokens;
      out.push({
        path: doc.path,
        source_folder: doc.sourceFolder,
        type: docType(doc.path),
        tokens,
        bytes: doc.bytes,
        used_by_agents: usageCounts.get(doc.path) ?? 0,
        missing: false,
      });
    }

    // Attached-but-absent documents (E-2): the walk can never find them (the
    // file is gone), so surface them explicitly instead of silently dropping
    // the attachment from the page.
    for (const path of attachedPaths) {
      if (discoveredPaths.has(path)) continue;
      out.push({
        path,
        source_folder: '',
        type: docType(path),
        tokens: 0,
        bytes: 0,
        used_by_agents: usageCounts.get(path) ?? 0,
        missing: true,
      });
    }

    return {
      documents: out,
      total_tokens,
      total_files: out.length,
      degraded_reason: null,
      roots: this.container.config.projectContextRoots,
    };
  }

  /** GET /repos/:repoId/context/document?path= — read-only preview content,
   *  plus the AC-37 staleness token (Rec-1: a content hash, not an mtime).
   *  Returns undefined on repo-not-found / no-clone / path-escape / missing
   *  file — the route maps all of these to a plain 404, never distinguishing
   *  "escaped the clone" from "not found" to the caller (A05). */
  async getDocumentContent(
    workspaceId: string,
    repoId: string,
    path: string,
  ): Promise<{ path: string; content: string; revision: string } | undefined> {
    const repoRow = await this.repo.getRepo(workspaceId, repoId);
    if (!repoRow?.clonePath) return undefined;
    const abs = isInsideClone(repoRow.clonePath, path);
    if (!abs) return undefined;
    const buf = await readFile(abs).catch(() => null);
    if (buf == null) return undefined;
    return { path, content: buf.toString('utf8'), revision: revisionOf(buf) };
  }

  /**
   * PUT /repos/:repoId/context/document — overwrite an EXISTING `.md` file
   * inside the clone (AC-34). Clears the shared write-guard chain (Rec-6),
   * then requires the caller's `revision` to still match the file's current
   * content hash (AC-37) — a mismatch means the file moved since the editor
   * loaded it, rejected with `ConflictError` rather than silently
   * overwritten. No git operation of any kind (AC-38). A failed write
   * propagates as an error, never a partial success (AC-39/NFR A10).
   */
  async saveDocument(
    workspaceId: string,
    repoId: string,
    input: { path: string; content: string; revision: string },
    log?: WriteLogger,
  ): Promise<ContextWriteResult> {
    const repoRow = await this.repo.getRepo(workspaceId, repoId);
    if (!repoRow) throw new NotFoundError('Repo not found');
    if (!repoRow.clonePath) {
      throw new ValidationError('Repo has no local clone — cannot save a document');
    }

    const resolved = resolveWritablePath(
      repoRow.clonePath,
      this.container.config.projectContextRoots,
      input.path,
    );
    if (!resolved.ok) {
      throw new ValidationError(`Rejected document path (${resolved.reason})`);
    }
    if (!assertContentWithinCap(input.content)) {
      throw new ValidationError('Document exceeds the per-document byte cap');
    }

    // AC-36 — the path must resolve to an EXISTING file, not just a valid
    // shape; a save never creates (E-18, "recreate through creation instead").
    let existingStat;
    try {
      existingStat = await stat(resolved.absPath);
    } catch {
      throw new ValidationError('Document does not exist — use the create action instead');
    }
    if (!existingStat.isFile()) {
      throw new ValidationError('Document does not exist — use the create action instead');
    }

    // AC-37 — re-read and re-hash right before the write so the staleness
    // check is as close to the write as possible.
    const currentBuf = await readFile(resolved.absPath);
    if (revisionOf(currentBuf) !== input.revision) {
      throw new ConflictError('Document changed on disk since it was loaded — reload and retry');
    }

    await writeFile(resolved.absPath, input.content, 'utf8');
    log?.info(
      { path: input.path, bytes: Buffer.byteLength(input.content, 'utf8'), outcome: 'saved' },
      'project-context: document saved',
    );

    return this.writeResultFor(workspaceId, repoId, input.path, input.content);
  }

  /**
   * POST /repos/:repoId/context/document — create a NEW `.md` file inside
   * the clone (AC-41). Same guard chain as `saveDocument` (Rec-6), then an
   * atomic exclusive write (`flag: 'wx'`, Rec-3) so the must-not-exist check
   * is atomic with the write itself (AC-44/E-23) rather than a separate
   * prior `stat`. No "manually added" record of any kind — the document
   * enters the product on the next discovery walk (AC-42).
   */
  async createDocument(
    workspaceId: string,
    repoId: string,
    input: { path: string; content: string },
    log?: WriteLogger,
  ): Promise<ContextWriteResult> {
    const repoRow = await this.repo.getRepo(workspaceId, repoId);
    if (!repoRow) throw new NotFoundError('Repo not found');
    if (!repoRow.clonePath) {
      throw new ValidationError('Repo has no local clone — cannot create a document');
    }

    const resolved = resolveWritablePath(
      repoRow.clonePath,
      this.container.config.projectContextRoots,
      input.path,
    );
    if (!resolved.ok) {
      throw new ValidationError(`Rejected document path (${resolved.reason})`);
    }
    if (!assertContentWithinCap(input.content)) {
      throw new ValidationError('Document exceeds the per-document byte cap');
    }

    // AC-46 — create missing nested directories inside the clone only; every
    // segment of `resolved.absPath` already passed `isInsideClone` and the
    // excluded-directory check above.
    await mkdir(dirname(resolved.absPath), { recursive: true });

    try {
      await writeFile(resolved.absPath, input.content, { encoding: 'utf8', flag: 'wx' });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new ValidationError('A document already exists at this path');
      }
      throw err;
    }
    log?.info(
      { path: input.path, bytes: Buffer.byteLength(input.content, 'utf8'), outcome: 'created' },
      'project-context: document created',
    );

    return this.writeResultFor(workspaceId, repoId, input.path, input.content);
  }

  /** Shared fresh-metadata builder for both write paths (AC-40) — never
   *  re-reads the file we just wrote; the caller's own `content` is the
   *  source of truth for size/tokens/revision. */
  private async writeResultFor(
    workspaceId: string,
    repoId: string,
    path: string,
    content: string,
  ): Promise<ContextWriteResult> {
    const usageCounts = await this.repo.usageCountsByPath(workspaceId, repoId);
    const document: ContextDocument = {
      path,
      source_folder: path.split('/')[0] ?? '',
      type: docType(path),
      tokens: this.container.tokenizer.count(content),
      bytes: Buffer.byteLength(content, 'utf8'),
      used_by_agents: usageCounts.get(path) ?? 0,
      missing: false,
    };
    return { document, revision: revisionOf(Buffer.from(content, 'utf8')) };
  }

  /** GET /skills/:id/context, GET /agents/:id/context — one surface's own
   *  attached set for one repo, with its token total. */
  async listAttachments(
    workspaceId: string,
    surface: ContextSurface,
    surfaceId: string,
    repoId: string,
  ): Promise<ContextAttachmentSet> {
    const [rows, all] = await Promise.all([
      this.repo.listFor(workspaceId, surface, surfaceId, repoId),
      this.repo.listForAll(workspaceId, surface, surfaceId),
    ]);
    const total_tokens = await this.sumTokens(workspaceId, repoId, rows.map((r) => r.path));
    const other_repo_documents = all
      .filter((r) => r.repoId !== repoId)
      .map((r) => ({ repo_id: r.repoId, path: r.path, order: r.order }));
    return { repo_id: repoId, documents: rows, total_tokens, other_repo_documents };
  }

  /** POST /skills/:id/context, POST /agents/:id/context — replace the whole
   *  attached set for this surface+repo. Every path must resolve inside the
   *  repo's clone (AC-16) — on any escape, nothing is persisted and the
   *  caller gets a 4xx (route maps the thrown error). */
  async setAttachments(
    workspaceId: string,
    surface: ContextSurface,
    surfaceId: string,
    repoId: string,
    paths: string[],
  ): Promise<ContextAttachmentSet> {
    const repoRow = await this.repo.getRepo(workspaceId, repoId);
    if (!repoRow?.clonePath) {
      throw new ValidationError('Repo has no local clone — cannot validate attachment paths');
    }
    for (const path of paths) {
      if (!isInsideClone(repoRow.clonePath, path)) {
        throw new ValidationError(`Path escapes the repo clone: ${path}`);
      }
    }
    await this.repo.replaceFor(workspaceId, surface, surfaceId, repoId, paths);
    return this.listAttachments(workspaceId, surface, surfaceId, repoId);
  }

  /**
   * Run-time resolution (AC-17–AC-22): agent-direct ∪ enabled-linked-skill
   * attachments, deduped by path keeping the lowest order (D-1/AC-14), each
   * read fresh from disk (AC-17), skipped on read failure/binary/whitespace-
   * only (E-2, E-4, E-5), truncated per-document at MAX_DOC_CHARS, then cut
   * to PROJECT_CONTEXT_TOKEN_BUDGET in persisted order (AC-22).
   */
  async resolveEffectiveSet(
    workspaceId: string,
    agentId: string,
    repoId: string,
  ): Promise<EffectiveSetResult> {
    const mismatchedRows = await this.repo.listMismatchedForAgent(workspaceId, agentId, repoId);
    const mismatched = [...new Set(mismatchedRows.map((r) => r.path))];

    const repoRow = await this.repo.getRepo(workspaceId, repoId);
    if (!repoRow?.clonePath) return { entries: [], skipped: [], truncated: [], mismatched };
    const clonePath = repoRow.clonePath;

    const rows = await this.repo.listForAgentEffective(workspaceId, agentId, repoId);
    // AC-15 defense-in-depth: skip disabled-skill rows before dedupe/read.
    // SQL already filters `enabled = true`; this catches a stub/bypass.
    const eligible = rows.filter((r) => !(r.source === 'skill' && r.enabled === false));

    // Dedupe by path, keeping the entry with the LOWEST persisted order
    // (D-1/AC-14): a document attached both directly and via an enabled
    // skill is injected once, at its earliest position.
    const byPath = new Map<string, number>();
    for (const r of eligible) {
      const existing = byPath.get(r.path);
      if (existing === undefined || r.order < existing) byPath.set(r.path, r.order);
    }
    const ordered = [...byPath.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([path]) => path);

    const skipped: string[] = [];
    const candidates: EffectiveDocEntry[] = [];
    for (const path of ordered) {
      const abs = isInsideClone(clonePath, path);
      if (!abs) {
        skipped.push(path); // treat an escaping stored path like E-2 — never read it
        continue;
      }
      const raw = await readUtf8OrNull(abs);
      if (raw == null) {
        skipped.push(path); // deleted/renamed/unreadable (E-2) or invalid UTF-8 / binary (E-5)
        continue;
      }
      if (raw.trim().length === 0) {
        skipped.push(path); // whitespace-only (E-4) — never an empty <untrusted> entry
        continue;
      }
      const text = buildEntryText(path, truncateText(raw, MAX_DOC_CHARS));
      const tokens = this.container.tokenizer.count(text);
      candidates.push({ path, text, tokens, chars: text.length });
    }

    // Budget cutoff (AC-22): walk in persisted order accumulating tokens;
    // the first candidate that would exceed the budget — and everything
    // after it — becomes the truncated remainder.
    let used = 0;
    let cutoff = candidates.length;
    for (let i = 0; i < candidates.length; i++) {
      if (used + candidates[i]!.tokens > PROJECT_CONTEXT_TOKEN_BUDGET) {
        cutoff = i;
        break;
      }
      used += candidates[i]!.tokens;
    }

    return {
      entries: candidates.slice(0, cutoff),
      skipped,
      truncated: candidates.slice(cutoff).map((c) => c.path),
      mismatched,
    };
  }

  /** Best-effort token total for a set of already-persisted attachment
   *  paths — reads each file fresh (same "no cached body" rule, AC-5) but
   *  never throws: an unreadable/missing path just contributes 0 so the
   *  Context tabs' total never breaks on a stale attachment. */
  private async sumTokens(workspaceId: string, repoId: string, paths: string[]): Promise<number> {
    if (paths.length === 0) return 0;
    const repoRow = await this.repo.getRepo(workspaceId, repoId);
    if (!repoRow?.clonePath) return 0;
    let total = 0;
    for (const path of paths) {
      const abs = isInsideClone(repoRow.clonePath, path);
      if (!abs) continue;
      const text = await readFile(abs, 'utf8').catch(() => '');
      total += this.container.tokenizer.count(text);
    }
    return total;
  }
}
