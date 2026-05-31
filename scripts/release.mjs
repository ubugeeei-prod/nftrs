#!/usr/bin/env node
// Release driver for the npm package `@nftrs/core` (+ the per-platform
// `@nftrs/binding-*` packages). Bumps the version, syncs the Rust workspace
// version + Cargo.lock, refreshes the generated NAPI loader metadata, commits,
// tags `v<version>`, and pushes the tag — which triggers
// `.github/workflows/publish.yml` to build every platform binary and publish to
// npm via OIDC trusted publishing (no token).
//
// Usage (via Vite+):
//   vp run release <patch|minor|major> [-y|--yes] [--dry-run]
//
// Examples:
//   vp run release minor -y      # 0.0.0 -> 0.1.0, tag + push, GHA publishes
//   vp run release patch --dry-run   # print the plan, change nothing
//
// Prerequisite (one-time, needs `npm login`): configure the trusted publisher
// for each package — see `scripts/setup-trusted-publishing.sh` and
// docs/PUBLISHING.md.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG_DIR = path.join(ROOT, 'crates', 'nftrs_napi');
const PKG_PATH = path.join(PKG_DIR, 'package.json');
const CARGO_PATH = path.join(ROOT, 'Cargo.toml');

const args = process.argv.slice(2);
const level = args.find((a) => ['patch', 'minor', 'major'].includes(a));
const yes = args.includes('-y') || args.includes('--yes');
const dryRun = args.includes('--dry-run');

function die(msg) {
  console.error(msg);
  process.exit(1);
}

if (!level) {
  die('Usage: vp run release <patch|minor|major> [-y|--yes] [--dry-run]');
}

const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim();
const runInherit = (cmd, ...a) => execFileSync(cmd, a, { cwd: ROOT, stdio: 'inherit' });
const runInheritIn = (cwd, cmd, ...a) => execFileSync(cmd, a, { cwd, stdio: 'inherit' });

// --- compute the next version ----------------------------------------------
const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf8'));
const [maj, min, pat] = pkg.version.split('.').map((n) => parseInt(n, 10));
if ([maj, min, pat].some(Number.isNaN)) {
  die(`Cannot parse current version "${pkg.version}" in ${PKG_PATH}`);
}
const next =
  level === 'major'
    ? `${maj + 1}.0.0`
    : level === 'minor'
      ? `${maj}.${min + 1}.0`
      : `${maj}.${min}.${pat + 1}`;
const tag = `v${next}`;

console.log(`\nRelease: ${pkg.version} -> ${next}  (${level})  tag ${tag}\n`);

// --- safety checks ----------------------------------------------------------
const branch = git('rev-parse', '--abbrev-ref', 'HEAD');
const status = git('status', '--porcelain');
if (status && !dryRun) {
  die(`Working tree is not clean — commit or stash first:\n${status}`);
}
const existingTags = git('tag', '--list', tag);
if (existingTags && !dryRun) {
  die(`Tag ${tag} already exists.`);
}

if (dryRun) {
  console.log('--dry-run: would perform');
  console.log(`  • set crates/nftrs_napi/package.json version -> ${next}`);
  console.log(`  • set @nftrs/binding-* optionalDependencies -> ${next}`);
  console.log(`  • set [workspace.package] version in Cargo.toml -> ${next}`);
  console.log('  • cargo update --workspace   (sync Cargo.lock)');
  console.log('  • npx --yes -p @napi-rs/cli@3 napi build --release --platform');
  console.log(`  • git commit -m "release: ${tag}"`);
  console.log(`  • git tag ${tag}`);
  console.log(`  • git push origin ${branch} && git push origin ${tag}`);
  console.log('\nThe tag push triggers .github/workflows/publish.yml (OIDC publish).');
  process.exit(0);
}

if (!yes) {
  die('Refusing to release without confirmation. Re-run with -y (or --yes).');
}

// --- apply the bump ---------------------------------------------------------
pkg.version = next;
for (const name of Object.keys(pkg.optionalDependencies ?? {})) {
  if (name.startsWith('@nftrs/binding-')) {
    pkg.optionalDependencies[name] = next;
  }
}
fs.writeFileSync(PKG_PATH, `${JSON.stringify(pkg, null, 2)}\n`);

let cargo = fs.readFileSync(CARGO_PATH, 'utf8');
const before = cargo;
// Bump the [workspace.package] version (the standalone `version = "..."` line).
cargo = cargo.replace(/^version = "[^"]*"$/m, `version = "${next}"`);
// Bump the [workspace.dependencies] pins for the internal crates — they carry
// an explicit `version = "..."` that must track the package version, or cargo
// fails to resolve (`nftrs_analyzer = "^0.0.0"` vs the bumped 0.1.0).
cargo = cargo.replace(/^(nftrs_\w+ = \{ version = )"[^"]*"/gm, `$1"${next}"`);
if (cargo === before) {
  die('Could not find [workspace.package] version in Cargo.toml');
}
fs.writeFileSync(CARGO_PATH, cargo);

// Sync Cargo.lock to the new workspace version.
runInherit('cargo', 'update', '--workspace');

// Refresh the generated JS loader so its native binding version checks match
// the package version being released.
runInheritIn(PKG_DIR, 'npx', '--yes', '-p', '@napi-rs/cli@3', 'napi', 'build', '--release', '--platform');

// --- commit, tag, push ------------------------------------------------------
runInherit(
  'git',
  'add',
  'crates/nftrs_napi/package.json',
  'crates/nftrs_napi/index.js',
  'crates/nftrs_napi/index.d.ts',
  'Cargo.toml',
  'Cargo.lock',
);
runInherit('git', 'commit', '-m', `release: ${tag}`);
runInherit('git', 'tag', tag);
runInherit('git', 'push', 'origin', branch);
runInherit('git', 'push', 'origin', tag);

console.log(`\n✓ Pushed ${tag}. .github/workflows/publish.yml will build every`);
console.log('  platform binary and publish @nftrs/core + @nftrs/binding-* via OIDC.');
console.log('  Track it: gh run watch  (or the Actions tab).');
