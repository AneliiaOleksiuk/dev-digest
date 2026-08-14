import { describe, it, expect } from "vitest";
import { parseListItems, parseRunLocallyCommands } from "./parseSection";

describe("parseListItems", () => {
  it("splits a dash bullet list and pulls the first inline-code token as path", () => {
    const body = [
      "- `src/server.ts` — App bootstrap + middleware chain",
      "- `src/lib/redis.ts` — Shared Redis singleton — reuse this",
    ].join("\n");
    expect(parseListItems(body)).toEqual([
      { path: "src/server.ts", description: "App bootstrap + middleware chain" },
      { path: "src/lib/redis.ts", description: "Shared Redis singleton — reuse this" },
    ]);
  });

  it("splits a numbered list the same way", () => {
    const body = [
      "1. `src/server.ts` — See the whole request lifecycle in one file",
      "2. `src/middleware/auth.ts` — Auth touches almost everything downstream",
    ].join("\n");
    expect(parseListItems(body)).toEqual([
      { path: "src/server.ts", description: "See the whole request lifecycle in one file" },
      { path: "src/middleware/auth.ts", description: "Auth touches almost everything downstream" },
    ]);
  });

  it("joins a continuation line into the preceding item", () => {
    const body = "- `src/db.ts` — the shared client\n  used by every module";
    expect(parseListItems(body)).toEqual([
      { path: "src/db.ts", description: "the shared client used by every module" },
    ]);
  });

  it("keeps a chain of multiple paths visible in the description", () => {
    const body = "- `src/server.ts` → `src/db.ts` → `postgres`";
    expect(parseListItems(body)).toEqual([
      { path: "src/server.ts", description: "`src/db.ts` → `postgres`".replace(/`([^`\n]+)`/g, "$1") },
    ]);
  });

  it("returns an empty array for prose with no list markers", () => {
    expect(parseListItems("Just a sentence, no bullets here.")).toEqual([]);
  });

  it("drops a bullet with no path and no remaining text", () => {
    expect(parseListItems("-   ")).toEqual([]);
  });

  it("strips markdown bold/italic markers from the description instead of leaving literal asterisks", () => {
    const body = "- `server/src/server.ts` — **Server entry**: loads config and starts listening.";
    expect(parseListItems(body)).toEqual([
      { path: "server/src/server.ts", description: "Server entry: loads config and starts listening." },
    ]);
  });

  it("does not corrupt a snake_case identifier that isn't emphasis", () => {
    const body = "- `server/src/platform/run-logger.ts` — wraps `RunBus` and logs run_logger events";
    expect(parseListItems(body)).toEqual([
      { path: "server/src/platform/run-logger.ts", description: "wraps RunBus and logs run_logger events" },
    ]);
  });
});

describe("parseRunLocallyCommands", () => {
  it("extracts fenced-code lines, dropping blank and comment-only lines", () => {
    const body = ["```bash", "pnpm install", "", "# a full-line comment", "pnpm dev  # from package.json", "```"].join(
      "\n",
    );
    expect(parseRunLocallyCommands(body)).toEqual(["pnpm install", "pnpm dev  # from package.json"]);
  });

  it("falls back to bullet-list inline-code commands when no fenced block is present", () => {
    const body = ["- `npm run dev` (from `package.json`)", "- `npm run build` (from `package.json`)"].join("\n");
    expect(parseRunLocallyCommands(body)).toEqual(["npm run dev", "npm run build"]);
  });

  it("returns an empty array when neither shape is present", () => {
    expect(parseRunLocallyCommands("No run-locally instructions were found.")).toEqual([]);
  });
});
