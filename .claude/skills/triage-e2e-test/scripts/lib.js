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
import { execFileSync, spawnSync } from 'child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Repo root, resolved from this script's own location (scripts live at .claude/skills/triage-e2e-test/scripts). */
export function repoRoot() {
	return path.resolve(HERE, '..', '..', '..', '..');
}

/** Absolute path to a shared e2e-failure-analyzer script (reused verbatim, no copies). */
export function analyzerScript(name) {
	return path.resolve(HERE, '..', '..', 'e2e-failure-analyzer', 'scripts', name);
}

/** Root of all triage work directories. Gitignored (.claude/work/**). */
export function workRoot() {
	return path.join(repoRoot(), '.claude', 'work', 'triage-e2e-test');
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
	const s = JSON.stringify(data, null, 2);
	fs.writeFileSync(file, s);
	_rawBytesWritten += Buffer.byteLength(s);
	return file;
}

export function writeText(file, text) {
	ensureDir(path.dirname(file));
	const s = String(text);
	fs.writeFileSync(file, s);
	_rawBytesWritten += Buffer.byteLength(s);
	return file;
}

/** Print a compact object as JSON to stdout (the model reads this). */
export function emit(obj) {
	const s = JSON.stringify(obj, null, 2) + '\n';
	_stdoutBytes += Buffer.byteLength(s);
	process.stdout.write(s);
}

/**
 * Emit a structured error and exit non-zero. The skill treats a non-zero exit
 * or an `error` field as "stop and surface", never as "fall back to a broader,
 * more expensive path".
 */
export function fail(message, extra = {}) {
	emit({ error: message, ...extra });
	recordMetric({ failed: true, error: String(message).slice(0, 200) });
	process.exit(1);
}

// --- Cost instrumentation (best-effort; never breaks a triage) ------------
// Each helper is a fresh process, so module-load time approximates process
// start. `emit` / `writeJson` / `writeText` accumulate the byte counts that
// prove the "raw to disk, compact to stdout" boundary; helpers add domain
// counts (occurrencesFetched, prsReturned, ...) when they call recordMetric.
const METRICS_START = Date.now();
let _stdoutBytes = 0;
let _rawBytesWritten = 0;
let _script = null;

/** Label the current helper for metrics (called once at the top of main). */
export function setMetricScript(name) {
	_script = name;
}

/** Shape one metrics record. Pure -- ctx carries the process-tracked fields. */
export function buildMetricRecord(fields, ctx) {
	return {
		ts: ctx.ts,
		script: ctx.script ?? null,
		durationMs: ctx.durationMs,
		stdoutBytes: ctx.stdoutBytes,
		rawBytesWritten: ctx.rawBytesWritten,
		...fields,
	};
}

/**
 * Append one metrics line to `<workRoot>/metrics.jsonl`. Auto-fills
 * duration / stdout bytes / raw bytes written tracked across this process; the
 * caller passes domain counts. Best-effort: any failure is swallowed so
 * instrumentation can never break a triage.
 */
export function recordMetric(fields = {}) {
	try {
		const record = buildMetricRecord(fields, {
			ts: new Date().toISOString(),
			script: _script,
			durationMs: Date.now() - METRICS_START,
			stdoutBytes: _stdoutBytes,
			rawBytesWritten: _rawBytesWritten,
		});
		const file = path.join(workRoot(), 'metrics.jsonl');
		ensureDir(path.dirname(file));
		fs.appendFileSync(file, JSON.stringify(record) + '\n');
	} catch { /* metrics are best-effort */ }
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

/**
 * Like runNode but also captures stderr (returns { stdout, stderr }) so the
 * caller can parse progress lines. Throws on non-zero exit. Use when a wrapped
 * script only surfaces a needed value (e.g. a kept temp-dir path) via stderr.
 */
export function runNodeCapture(scriptPath, args) {
	const r = spawnSync('node', [scriptPath, ...args], {
		cwd: repoRoot(),
		encoding: 'utf8',
		maxBuffer: 256 * 1024 * 1024,
	});
	if (r.status !== 0) {
		const err = new Error(`node ${scriptPath} exited ${r.status}: ${String(r.stderr || '').slice(-500)}`);
		err.stderr = r.stderr;
		throw err;
	}
	return { stdout: r.stdout, stderr: r.stderr || '' };
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
