#!/usr/bin/env node
// checkpoint.js -- durable triage state for start / resume / status.
//
// State lives at .claude/work/triage-e2e-test/<triage-id>/state.json (gitignored).
// A resume reads the checkpoint and continues from `phase`/`nextAction` without
// replaying completed history work.
//
// Usage:
//   node checkpoint.js --triage-id <id> --init --test-key <key> [--branch b] [--lookback-days n]
//   node checkpoint.js --triage-id <id> --read
//   node checkpoint.js --triage-id <id> --set phase=hypothesis-ready --set selectedPattern=A
//   node checkpoint.js --triage-id <id> --patch '<json>'     # deep-merge a JSON object
//   node checkpoint.js --status                              # list all triages
//   node checkpoint.js --triage-id <id> --validate

import fs from 'fs';
import path from 'path';
import {
	workRoot, triageDir, ensureDir, readJson, writeJson,
	emit, fail, isMain, parseArgs,
} from './lib.js';

export const PHASES = [
	'awaiting-pattern-selection',
	'pattern-selected',
	'evidence-gathered',
	'hypothesis-ready',
	'awaiting-clear',
	'implementation',
	'done',
];

const CHECKPOINT_VERSION = 1;

/** Validate a checkpoint before resuming. Returns { ok, errors[] }. */
export function validateCheckpoint(state) {
	const errors = [];
	if (!state || typeof state !== 'object') { return { ok: false, errors: ['state is not an object'] }; }
	if (state.version !== CHECKPOINT_VERSION) { errors.push(`unsupported version ${state.version} (expected ${CHECKPOINT_VERSION})`); }
	if (!state.triageId) { errors.push('missing triageId'); }
	if (!state.testKey || !String(state.testKey).includes('|||')) { errors.push('missing/malformed testKey'); }
	if (!PHASES.includes(state.phase)) { errors.push(`unknown phase "${state.phase}"`); }
	return { ok: errors.length === 0, errors };
}

/** Deep-merge a patch object into state (objects merge, scalars/arrays replace). */
export function applyPatch(state, patch) {
	const out = { ...state };
	for (const [k, v] of Object.entries(patch)) {
		if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
			out[k] = applyPatch(out[k], v);
		} else {
			out[k] = v;
		}
	}
	return out;
}

/** Coerce `key=value` string values into booleans/numbers/null where obvious. */
export function coerce(value) {
	if (value === 'true') { return true; }
	if (value === 'false') { return false; }
	if (value === 'null') { return null; }
	if (value !== '' && !isNaN(Number(value))) { return Number(value); }
	return value;
}

function statePath(triageId) {
	return path.join(triageDir(triageId), 'state.json');
}

function newState(triageId, args) {
	return {
		version: CHECKPOINT_VERSION,
		triageId,
		testKey: args['test-key'] || null,
		branch: args.branch || null,
		lookbackDays: Number(args['lookback-days'] || 14),
		phase: 'awaiting-pattern-selection',
		history: null,
		patterns: [],
		selectedPattern: null,
		priorTriage: { status: 'unknown' },
		evidence: null,
		diagnosis: null,
		nextAction: 'Run the history helper, then select a failure pattern.',
		updatedAt: new Date().toISOString(),
	};
}

function statusAll() {
	const root = workRoot();
	if (!fs.existsSync(root)) { return { triages: [] }; }
	const triages = [];
	for (const id of fs.readdirSync(root)) {
		const sp = statePath(id);
		if (!fs.existsSync(sp)) { continue; }
		try {
			const s = readJson(sp);
			triages.push({ triageId: id, phase: s.phase, selectedPattern: s.selectedPattern, testKey: s.testKey, nextAction: s.nextAction, updatedAt: s.updatedAt });
		} catch { triages.push({ triageId: id, phase: 'unreadable' }); }
	}
	triages.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
	return { triages };
}

function main() {
	const args = parseArgs(process.argv.slice(2), ['init', 'read', 'status', 'validate']);

	if (args.status) { emit(statusAll()); return; }

	const triageId = args['triage-id'];
	if (!triageId) { fail('Missing --triage-id (or use --status).'); }
	const sp = statePath(triageId);

	if (args.init) {
		ensureDir(triageDir(triageId));
		const state = newState(triageId, args);
		writeJson(sp, state);
		emit({ ...state, stateFile: path.relative(process.cwd(), sp) });
		return;
	}

	if (!fs.existsSync(sp)) { fail(`No checkpoint for triage "${triageId}" (run --init first).`); }
	let state = readJson(sp);

	if (args.read || args.validate) {
		const v = validateCheckpoint(state);
		if (args.validate) { emit({ ...v, phase: state.phase, nextAction: state.nextAction }); return; }
		if (!v.ok) { emit({ ...state, _validation: v, stateFile: path.relative(process.cwd(), sp) }); return; }
		emit({ ...state, stateFile: path.relative(process.cwd(), sp) });
		return;
	}

	// Mutations: --patch and/or repeated --set key=value.
	let mutated = false;
	if (args.patch) {
		let patch;
		try { patch = JSON.parse(args.patch); } catch { fail('--patch must be valid JSON.'); }
		state = applyPatch(state, patch);
		mutated = true;
	}
	// parseArgs keeps only the last --set; collect all --set occurrences manually.
	const raw = process.argv.slice(2);
	for (let i = 0; i < raw.length; i++) {
		if (raw[i] === '--set' && raw[i + 1]) {
			const [k, ...rest] = raw[i + 1].split('=');
			state[k] = coerce(rest.join('='));
			mutated = true;
		}
	}

	if (!mutated) { fail('Nothing to do (use --init/--read/--set/--patch/--status/--validate).'); }
	state.updatedAt = new Date().toISOString();
	writeJson(sp, state);
	emit({ ...state, stateFile: path.relative(process.cwd(), sp) });
}

if (isMain(import.meta.url)) { main(); }
