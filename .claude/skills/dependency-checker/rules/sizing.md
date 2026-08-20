# Sizing — measuring installed weight

Use the bundled script rather than hand-rolling `du`/`Get-ChildItem` logic
inline — attributing size to the *right* dependency across pnpm's
symlink-into-content-store layout vs. npm's flat-copy layout is fiddly to
get right, and getting it wrong (e.g. double-counting a pnpm store hit
under every package that references it) produces a report that quietly
lies about which dependency is actually heavy.

```
node .claude/skills/dependency-checker/scripts/measure-sizes.mjs <package-dir>
```

Run once per package (e.g. `... server`, `... client`, ...). It's read-only
and prints one JSON object to stdout — nothing is written to disk.

## If `node_modules` is missing

The script returns `{ "installed": false }` instead of measuring anything —
it never runs an install itself. If you hit this:

1. Say so out loud to the user before doing anything about it — installing
   is a side-effecting network action, even though it's low-risk and
   reversible (it only materializes what `package.json`/the lockfile
   already declare).
2. Offer to run the package's own install command (`pnpm install` for a
   pnpm package, `npm install` for an npm one — see `discovery.md` for how
   to tell which) so the report can include real numbers for that package.
3. If the user would rather skip it, report that package's size as "not
   measured — node_modules not installed" rather than guessing from the
   lockfile. A silent guess is worse than an honest gap: the whole point of
   choosing on-disk measurement over lockfile estimation was accuracy.

## A layout quirk specific to this repo's machines

Don't assume "npm package → flat copies, no symlinks" here. On the
machine(s) this skill has been run on, `reviewer-core`, `mcp`, and `e2e`
all have a `package-lock.json` (npm is what a fresh `npm install` would
use) but their **currently installed** `node_modules` is physically laid
out pnpm-style anyway: a local `node_modules/.pnpm` store plus top-level
symlinks into it — check with `fs.lstatSync(path).isSymbolicLink()` on any
top-level entry, or just look for a `.pnpm` folder inside `node_modules`.
This is exactly why the script dedupes by realpath on **every** directory
it descends into, not only ones reached through a symlink — the `.pnpm`
folder is a plain subdirectory sitting right next to the symlinks that
point into it, so anything that dedupes only at symlink-crossing time
double-counts every package that has both a top-level alias and physical
content under `.pnpm`. If you ever port this sizing approach elsewhere,
keep that in mind rather than assuming the lockfile tells you the disk
layout.

## Reading the output

Two numbers, both correct, answering different questions:

- **`totalNodeModulesBytes`** — the package's real footprint on disk right
  now. Use this for "how heavy is this package's dependency tree overall."
- **`topLevelDeps[].bytes`** — each *direct* dependency's own size
  (including its nested deps), each measured independently. Use this for
  "which direct dependency is the heaviest" ranking. Don't sum this array
  and expect it to equal `totalNodeModulesBytes` — it won't, because
  transitive deps shared by two direct deps get counted once per direct
  dep here, but only once in the total. Mention this explicitly in the
  report if a reader might otherwise notice the numbers don't add up and
  assume a bug.

`topLevelDeps[].type` is `prod` / `dev` / `peer` / `optional`, taken
straight from which `package.json` field declared it — use this to group
the per-package inventory table, since a developer deciding whether a
heavy package is worth trimming cares a lot whether it ships to production
or only runs in CI/dev.

Convert bytes to human units (MB, one decimal place) only in the report —
keep raw bytes when comparing/sorting so rounding doesn't reorder close
values.
