/**
 * Oracle: `docs/plans/spec-05-multi-agent-ci-per-repo.md` Recommendation 7
 * ("Drop the client's workflow-path literal — it is load-bearing … Key off
 * the server-supplied `file.editable === true` instead … and match the
 * memory file by `endsWith("memory.jsonl")`") and
 * `specs/SPEC-05-multi-agent-ci-per-repo.md` AC-12 ("the client … shall stop
 * sending it [replace_existing]") — derived from the plan/spec text BEFORE
 * reading `helpers.ts`'s own implementation beyond its exported signatures.
 */
import { describe, it, expect } from "vitest";
import { isWorkflowFile, isMemoryFile, buildExportInput, isValidRepoRef } from "./helpers";
import type { CiFile } from "@/lib/types";

function file(overrides: Partial<CiFile>): CiFile {
  return { path: "some/path", contents: "", editable: false, preview_omitted: false, ...overrides };
}

describe("Recommendation 7: isWorkflowFile keys off file.editable === true, never a path literal", () => {
  it("a namespaced workflow filename is recognized purely because the server marked it editable", () => {
    const f = file({ path: ".github/workflows/devdigest-review-security-reviewer.yml", editable: true });
    expect(isWorkflowFile(f)).toBe(true);
  });

  it("a legacy workflow filename is ALSO recognized the same way", () => {
    const f = file({ path: ".github/workflows/devdigest-review.yml", editable: true });
    expect(isWorkflowFile(f)).toBe(true);
  });

  it("a non-editable file (e.g. the manifest) is never mistaken for the workflow file, even with a similar path", () => {
    const f = file({ path: ".devdigest/security-reviewer/agents/security-reviewer.yaml", editable: false });
    expect(isWorkflowFile(f)).toBe(false);
  });
});

describe('Recommendation 7: isMemoryFile keys off path.endsWith("memory.jsonl"), namespaced or legacy', () => {
  it("recognizes a namespaced memory path", () => {
    expect(isMemoryFile(file({ path: ".devdigest/security-reviewer/memory.jsonl" }))).toBe(true);
  });

  it("recognizes the legacy unnamespaced memory path", () => {
    expect(isMemoryFile(file({ path: ".devdigest/memory.jsonl" }))).toBe(true);
  });

  it("does not match an unrelated file", () => {
    expect(isMemoryFile(file({ path: ".devdigest/security-reviewer/skills/rubric.md" }))).toBe(false);
  });
});

describe("AC-12: buildExportInput never sends replace_existing", () => {
  it("the built body has no replace_existing key at all", () => {
    const input = buildExportInput({
      repo: "acme/payments-api",
      base: "main",
      triggers: ["opened"],
      postAs: "github_review",
      ingestUrl: "https://studio.example.com/ci/ingest",
      workflowOverride: null,
    });
    expect(input).not.toHaveProperty("replace_existing");
  });
});

describe("isValidRepoRef — unchanged client-side hint (server re-validates regardless)", () => {
  it("accepts owner/name", () => {
    expect(isValidRepoRef("acme/payments-api")).toBe(true);
  });

  it("rejects a bare name with no slash", () => {
    expect(isValidRepoRef("payments-api")).toBe(false);
  });
});
