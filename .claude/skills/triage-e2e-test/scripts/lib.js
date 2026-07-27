// Shared helpers for the triage-e2e-test skill scripts.
//
// These helpers keep every triage script deterministic and side-effect-honest:
// raw payloads land on disk under a per-triage work directory, and only compact
// JSON is printed to stdout. Errors are surfaced as structured `{ error }`
// objects rather than silently degrading into an expensive broad search.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Repo root, resolved from this script's own location (scripts live at .claude/skills/triage-e2e-test/scripts). */
export function repoRoot() {
	return path.resolve(HERE, '..', '..', '..', '..');
}

/** Absolute path to a shared e2e-failure-analyzer script (reused verbatim, no copies). */
export function analyzerScript(name) {
	return path.resolve(HERE, '..', '..', 'e2e-failure-analyzer', 'scripts', name);
}

/**
 * Root of all triage work directories.
 *
 * Anchored on the shared git *common* dir (e.g. <repo>/.git/triage-e2e-test) so
 * a triage started in one worktree is visible from every other worktree and
 * `--resume <id>` works no matter which checkout runs it. The previous location
 * (.claude/work/**) is gitignored and per-worktree, so a resume from a different
 * worktree silently found nothing. Falls back to that legacy path outside a git repo.
 */
let _workRootCache;
export function workRoot() {
	if (_workRootCache) { return _workRootCache; }
	const res = tryRun('git', ['rev-parse', '--git-common-dir']);
	if (res.ok && res.stdout.trim()) {
		// --git-common-dir is relative to repoRoot for the main worktree (".git")
		// and absolute for linked worktrees; path.resolve handles both.
		_workRootCache = path.join(path.resolve(repoRoot(), res.stdout.trim()), 'triage-e2e-test');
	} else {
		_workRootCache = path.join(repoRoot(), '.claude', 'work', 'triage-e2e-test');
	}
	return _workRootCache;
}

/** Per-triage work directory. */
export function triageDir(triageId) {
	return path.join(workRoot(), triageId);
}

/**
 * Derive a stable, filesystem-safe triage id from a test key or title.
 * Uses the leaf test title (last " > " segment) for readability, plus a short
 * hash of the *full* key so two tests that share a leaf name (e.g. "opens a
 * file" under different describe blocks / specs) never collide on one work dir.
 */
export function deriveTriageId(testKeyOrTitle) {
	const full = String(testKeyOrTitle);
	const title = full.split('|||')[0];
	const leaf = title.split(' > ').pop() || title;
	const slug = leaf
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 51) || 'triage';
	const hash = crypto.createHash('sha1').update(full).digest('hex').slice(0, 8);
	return `${slug}-${hash}`;
}

export function ensureDir(dir) {
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

export function readJson(file) {
	return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function writeJson(file, data) {
	ensureDir(path.dirname(file));
	fs.writeFileSync(file, JSON.stringify(data, null, 2));
	return file;
}

export function writeText(file, text) {
	ensureDir(path.dirname(file));
	fs.writeFileSync(file, text);
	return file;
}

/** Print a compact object as JSON to stdout (the model reads this). */
export function emit(obj) {
	process.stdout.write(JSON.stringify(obj, null, 2) + '\n');
}

/**
 * Emit a structured error and exit non-zero. The skill treats a non-zero exit
 * or an `error` field as "stop and surface", never as "fall back to a broader,
 * more expensive path".
 */
export function fail(message, extra = {}) {
	emit({ error: message, ...extra });
	process.exit(1);
}

/** Run a node script, capturing stdout. stderr streams through (progress messages). */
export function runNode(scriptPath, args) {
	return execFileSync('node', [scriptPath, ...args], {
		cwd: repoRoot(),
		encoding: 'utf8',
		maxBuffer: 256 * 1024 * 1024,
		stdio: ['ignore', 'pipe', 'inherit'],
	});
}

/** Run a command, returning { ok, stdout, stderr, status }. Never throws. */
export function tryRun(cmd, args) {
	try {
		const stdout = execFileSync(cmd, args, {
			cwd: repoRoot(),
			encoding: 'utf8',
			maxBuffer: 64 * 1024 * 1024,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		return { ok: true, stdout, stderr: '', status: 0 };
	} catch (err) {
		return {
			ok: false,
			stdout: err.stdout ? String(err.stdout) : '',
			stderr: err.stderr ? String(err.stderr) : String(err.message),
			status: typeof err.status === 'number' ? err.status : 1,
		};
	}
}

/** True when this module's importer is the entry point (CLI vs. imported-for-tests). */
export function isMain(importMetaUrl) {
	return process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(importMetaUrl);
}

/** Minimal flag parser: `--flag value` and boolean `--flag`. */
export function parseArgs(argv, booleanFlags = []) {
	const out = {};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (!a.startsWith('--')) { continue; }
		const key = a.slice(2);
		if (booleanFlags.includes(key)) {
			out[key] = true;
		} else {
			out[key] = argv[++i];
		}
	}
	return out;
}
