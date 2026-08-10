// Shared helpers for the debug-e2e-test skill scripts.
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

/** Repo root, resolved from this script's own location (scripts live at .claude/skills/debug-e2e-test/scripts). */
export function repoRoot() {
	return path.resolve(HERE, '..', '..', '..', '..');
}

/** Absolute path to a shared e2e-failure-analyzer script (reused verbatim, no copies). */
export function analyzerScript(name) {
	return path.resolve(HERE, '..', '..', 'e2e-failure-analyzer', 'scripts', name);
}

/**
 * Whether an e2e-test-insights API key is resolvable, matching the lookup order
 * in e2e-query-history.js (env var, then the repo-root .env.e2e).
 *
 * Checked before any query so a missing key fails as itself, with setup steps,
 * instead of surfacing later as an indistinguishable "API unreachable" empty {}.
 */
export function insightsApiKeyPresent() {
	return resolveInsightsApiKey() != null;
}

/**
 * Root of the *main* checkout: the parent of the shared git common dir. Equals
 * repoRoot() unless we're in a linked worktree.
 */
export function mainWorktreeRoot() {
	const res = tryRun('git', ['rev-parse', '--git-common-dir']);
	if (res.ok && res.stdout.trim()) {
		return path.dirname(path.resolve(repoRoot(), res.stdout.trim()));
	}
	return repoRoot();
}

/**
 * The usable API key, or null. Checks the environment, then this checkout's
 * .env.e2e, then the main checkout's.
 *
 * The last source is why this exists: .env.e2e is gitignored, so a fresh
 * worktree never has one even though the engineer's main checkout does. Without
 * it, working from a worktree -- the normal way this repo gets used -- looks
 * identical to having no key at all, and sends someone to 1Password for a
 * credential already sitting one directory over.
 */
export function resolveInsightsApiKey() {
	const fromEnv = process.env.E2E_INSIGHTS_API_KEY;
	if (isUsableInsightsApiKey(fromEnv)) { return String(fromEnv).trim().replace(/^(['"])(.*)\1$/s, '$2').trim(); }
	const seen = new Set();
	for (const root of [repoRoot(), mainWorktreeRoot()]) {
		if (seen.has(root)) { continue; }
		seen.add(root);
		try {
			const body = fs.readFileSync(path.join(root, '.env.e2e'), 'utf8');
			const line = /^\s*E2E_INSIGHTS_API_KEY\s*=\s*(.*)$/m.exec(body);
			if (line && isUsableInsightsApiKey(line[1])) {
				return line[1].trim().replace(/^(['"])(.*)\1$/s, '$2').trim();
			}
		} catch { /* try the next root */ }
	}
	return null;
}

/**
 * Whether a raw key value is usable. Both sources go through this, because the
 * placeholder from .env.e2e.example gets exported into the environment as often
 * as it gets left in the file -- and a placeholder that passes preflight defeats
 * the whole point of it, surfacing later as an indistinguishable "API unreachable".
 */
export function isUsableInsightsApiKey(value) {
	const key = String(value ?? '').trim().replace(/^(['"])(.*)\1$/s, '$2').trim();
	return key.length > 0 && key !== 'your_e2e_insights_api_key_here';
}

/** Setup steps for a missing API key. Kept here so every script reports it identically. */
export const MISSING_API_KEY_HELP = [
	'No e2e-test-insights API key found. This skill reads CI test history, so it cannot run without one.',
	'Set it up once:',
	'  1. Copy the key from 1Password: op://Positron/E2E_dashboard_api_key/credential',
	'     (CLI: op read "op://Positron/E2E_dashboard_api_key/credential")',
	'  2. Add it to .env.e2e in the repo root (copy .env.e2e.example if you have no .env.e2e yet):',
	'       E2E_INSIGHTS_API_KEY=<the key>',
	'     or export E2E_INSIGHTS_API_KEY=<the key> in your shell.',
	'No 1Password access? Ask the Positron QA team for the dashboard key.',
].join('\n');

/**
 * Root of all triage work directories.
 *
 * Anchored on the shared git *common* dir (e.g. <repo>/.git/debug-e2e-test) so
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
		_workRootCache = path.join(path.resolve(repoRoot(), res.stdout.trim()), 'debug-e2e-test');
	} else {
		_workRootCache = path.join(repoRoot(), '.claude', 'work', 'debug-e2e-test');
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

/**
 * Run a node script, capturing stdout. stderr streams through (progress messages).
 *
 * `extraEnv` matters for the analyzer scripts: they read .env.e2e relative to
 * process.cwd(), which is this (possibly linked) worktree, so a key resolved
 * from elsewhere has to be handed over explicitly or preflight passes and the
 * query itself still comes back empty.
 */
export function runNode(scriptPath, args, extraEnv = null) {
	return execFileSync('node', [scriptPath, ...args], {
		cwd: repoRoot(),
		encoding: 'utf8',
		maxBuffer: 256 * 1024 * 1024,
		stdio: ['ignore', 'pipe', 'inherit'],
		...(extraEnv ? { env: { ...process.env, ...extraEnv } } : {}),
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

/**
 * Declare a script's CLI surface once, so `--help`, the boolean-flag list handed
 * to parseArgs, and references/scripts.md all read from the same declaration.
 *
 * Before this existed each of those three lived separately and drifted:
 * find-prior-triage.js grew four flags the reference never documented (so the
 * skill could not use them), and the reference documented a --test-id on
 * fetch-pattern-evidence.js that the script never read. cli-flags.test.js holds
 * the declaration and the reference together.
 *
 * Each flag: { name, value, type, required, description }. `value` is the
 * placeholder shown in help (omit for booleans); `type: 'boolean'` also opts the
 * flag into parseArgs's boolean list.
 */
export function defineCli({ name, summary, usage = [], flags = [] }) {
	return {
		name,
		summary,
		usage,
		flags,
		booleanFlags: flags.filter(f => f.type === 'boolean').map(f => f.name),
		help() {
			const lines = [`${name} -- ${summary}`, ''];
			if (usage.length) {
				lines.push('Usage:');
				for (const u of usage) { lines.push(`  node ${name} ${u}`); }
				lines.push('');
			}
			lines.push('Flags:');
			const left = flags.map(f => `  --${f.name}${f.value ? ' ' + f.value : ''}`);
			const width = Math.max(...left.map(s => s.length), 0);
			flags.forEach((f, i) => {
				const req = f.required ? ' (required)' : '';
				lines.push(`${left[i].padEnd(width)}  ${f.description}${req}`);
			});
			return lines.join('\n') + '\n';
		},
	};
}

/**
 * Print help and exit 0 when `--help`/`-h` is present. Call before any argument
 * validation, so `--help` works on a script whose required flags are missing --
 * which is exactly when someone asks for it.
 */
export function handleHelp(cli, argv) {
	if (argv.includes('--help') || argv.includes('-h')) {
		process.stdout.write(cli.help());
		process.exit(0);
	}
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
