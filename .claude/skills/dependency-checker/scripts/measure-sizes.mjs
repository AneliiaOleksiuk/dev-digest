#!/usr/bin/env node
// Computes installed on-disk size for a single package's dependencies.
// Usage: node measure-sizes.mjs <path-to-package-dir>
// Prints one JSON object to stdout. Never mutates anything (read-only).
//
// Two different size numbers are reported, on purpose — see rules/sizing.md
// for why they can't be merged into one "correct" number:
//   - totalNodeModulesBytes: real footprint on disk. Symlink targets are
//     deduped by realpath across the whole node_modules tree, so a pnpm
//     content-addressable store (many top-level symlinks -> same physical
//     package) is not double-counted.
//   - topLevelDeps[].bytes: each *direct* dependency's own subtree size,
//     including its own nested node_modules, measured independently (fresh
//     dedup scope per dependency). Good for ranking "heaviest direct
//     dependency"; summing these will overcount shared transitive deps
//     relative to totalNodeModulesBytes — that's expected, not a bug.

import fs from 'node:fs';
import path from 'node:path';

const pkgDir = process.argv[2];
if (!pkgDir) {
  console.error('Usage: node measure-sizes.mjs <path-to-package-dir>');
  process.exit(1);
}

const pkgJsonPath = path.join(pkgDir, 'package.json');
const nodeModulesPath = path.join(pkgDir, 'node_modules');

if (!fs.existsSync(pkgJsonPath)) {
  console.error(`No package.json at ${pkgJsonPath}`);
  process.exit(1);
}

const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));

if (!fs.existsSync(nodeModulesPath)) {
  console.log(JSON.stringify({ packageDir: pkgDir, installed: false }, null, 2));
  process.exit(0);
}

function dirSize(dirPath, seen) {
  // Dedupe by realpath *on every directory visit*, not just when the entry
  // that led here was a symlink. pnpm (and, on this repo's machines, even
  // "npm" packages that happen to have been installed by pnpm underneath)
  // lays out node_modules as top-level symlinks pointing INTO a local
  // node_modules/.pnpm store that also sits there as a plain subdirectory.
  // Walking .pnpm as a normal subtree AND dereferencing each top-level
  // symlink into that same store double-counts every package that has a
  // top-level alias — checking realpath here, before descending, catches
  // both routes to the same physical directory.
  let real;
  try {
    real = fs.realpathSync(dirPath);
  } catch {
    return 0; // broken symlink or unreadable
  }
  if (seen.has(real)) return 0;
  seen.add(real);

  let entries;
  try {
    entries = fs.readdirSync(real, { withFileTypes: true });
  } catch {
    return 0;
  }
  let total = 0;
  for (const entry of entries) {
    const full = path.join(real, entry.name);
    let lstat;
    try {
      lstat = fs.lstatSync(full);
    } catch {
      continue;
    }
    if (lstat.isDirectory()) {
      total += dirSize(full, seen);
    } else if (lstat.isSymbolicLink()) {
      let target;
      try {
        target = fs.statSync(full); // follows the symlink
      } catch {
        continue; // broken symlink
      }
      if (target.isDirectory()) {
        total += dirSize(full, seen);
      } else {
        let r;
        try {
          r = fs.realpathSync(full);
        } catch {
          total += target.size;
          continue;
        }
        if (!seen.has(r)) {
          seen.add(r);
          total += target.size;
        }
      }
    } else {
      total += lstat.size;
    }
  }
  return total;
}

function resolveDepDir(name) {
  // scoped package name like "@scope/name" maps to node_modules/@scope/name
  return path.join(nodeModulesPath, ...name.split('/'));
}

function collectDeps(field, type) {
  const record = pkgJson[field] || {};
  return Object.entries(record).map(([name, range]) => ({ name, range, type }));
}

const declared = [
  ...collectDeps('dependencies', 'prod'),
  ...collectDeps('devDependencies', 'dev'),
  ...collectDeps('peerDependencies', 'peer'),
  ...collectDeps('optionalDependencies', 'optional'),
];

const topLevelDeps = declared.map(({ name, range, type }) => {
  const depDir = resolveDepDir(name);
  const exists = fs.existsSync(depDir);
  const bytes = exists ? dirSize(depDir, new Set()) : 0;
  let installedVersion = null;
  if (exists) {
    try {
      installedVersion = JSON.parse(
        fs.readFileSync(path.join(depDir, 'package.json'), 'utf8'),
      ).version;
    } catch {
      // package.json missing/unreadable inside the dep dir — leave null
    }
  }
  return { name, range, type, installed: exists, installedVersion, bytes };
});

const totalNodeModulesBytes = dirSize(nodeModulesPath, new Set());

console.log(
  JSON.stringify(
    {
      packageDir: pkgDir,
      packageName: pkgJson.name,
      installed: true,
      totalNodeModulesBytes,
      topLevelDeps: topLevelDeps.sort((a, b) => b.bytes - a.bytes),
    },
    null,
    2,
  ),
);
