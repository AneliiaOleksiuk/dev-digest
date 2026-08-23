/**
 * Compares this run's records against a committed baseline snapshot
 * (evals/baselines/<slug>.json, written by `pnpm eval:repeat ... --label baseline --commit`).
 * Publishes a markdown table — appended to $GITHUB_STEP_SUMMARY when set (CI), stdout otherwise.
 *
 * Never fails the process: this is a report, not a gate. `pnpm eval:quality` is the only
 * blocking check in CI (see AGENTS.md's routing table).
 *
 *   pnpm eval:report skills/onion-architecture     # run after `vitest run skills/onion-architecture`
 */

import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { EVALS_DIR } from "./artifacts/paths.js";
import { aggregate, loadRecords, type NodeAggregate } from "./records/stats.js";

const BASELINES_DIR = join(EVALS_DIR, "baselines");

// Must match repeat.ts's --commit slug: path separators -> "-".
const slugify = (pattern: string) => pattern.replace(/[\\/]/g, "-");

const pct = (rate: number) => `${Math.round(rate * 100)}%`;
const shortId = (nodeid: string) => nodeid.split(" > ").slice(-1)[0];

function main(): void {
  const pattern = process.argv[2];
  if (!pattern) {
    console.error("usage: pnpm eval:report <vitest pattern>");
    process.exit(1);
  }

  const current = aggregate(loadRecords());
  const baselineFile = join(BASELINES_DIR, `${slugify(pattern)}.json`);
  const lines: string[] = [`### eval report — \`${pattern}\``, ""];

  if (!existsSync(baselineFile)) {
    lines.push(
      `⚠️ no committed baseline at \`evals/baselines/${slugify(pattern)}.json\` — run ` +
        `\`pnpm eval:repeat ${pattern} -n 2 --label baseline --commit\` to create one.`,
      "",
    );
    for (const id of Object.keys(current).sort()) {
      const a = current[id];
      lines.push(`- ${pct(a.pass.rate)} (${a.pass.passed}/${a.pass.total}) — ${shortId(id)}`);
    }
  } else {
    const baseline = JSON.parse(readFileSync(baselineFile, "utf8")) as {
      tests: Record<string, NodeAggregate>;
      calibrated_at: string;
    };
    lines.push(`baseline calibrated: ${baseline.calibrated_at}`, "", "| test | baseline | current | Δ |", "|---|---|---|---|");
    const ids = new Set([...Object.keys(baseline.tests), ...Object.keys(current)]);
    let regressed = false;
    for (const id of [...ids].sort()) {
      const b = baseline.tests[id];
      const c = current[id];
      const bRate = b?.pass.rate;
      const cRate = c?.pass.rate;
      const delta = bRate !== undefined && cRate !== undefined ? cRate - bRate : undefined;
      if (delta !== undefined && delta < 0) regressed = true;
      const deltaCell = delta === undefined ? "—" : `${delta >= 0 ? "+" : ""}${Math.round(delta * 100)}%${delta < 0 ? " 🔻" : ""}`;
      lines.push(`| ${shortId(id)} | ${bRate !== undefined ? pct(bRate) : "—"} | ${cRate !== undefined ? pct(cRate) : "—"} | ${deltaCell} |`);
    }
    if (regressed) lines.push("", "🔻 regression vs baseline — review before merging.");
  }

  const report = lines.join("\n") + "\n";
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (summaryFile) appendFileSync(summaryFile, report);
  else console.log(report);
}

main();
