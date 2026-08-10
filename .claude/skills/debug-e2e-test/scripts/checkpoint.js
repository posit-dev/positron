#!/usr/bin/env node
// checkpoint.js -- durable triage state for start / resume / status.
//
// State lives at <git-common-dir>/debug-e2e-test/<triage-id>/state.json,
// shared across worktrees so --resume works from any checkout.
// A resume reads the checkpoint and continues from `phase`/`nextAction` without
// replaying completed history work.
//
// Flags: see CLI below, or run with --help.
//
// --patch WARNING: arrays (e.g. patterns) REPLACE wholesale, not merge by
// element. To annotate one pattern without resending the others, use
// --patch-pattern A --patch '{"note": "..."}'.

import fs from 'fs';
import path from 'path';
import {
	workRoot, triageDir, ensureDir, readJson, writeJson,
	emit, fail, isMain, parseArgs, defineCli, handleHelp,
} from './lib.js';

export const CLI = defineCli({
	name: 'checkpoint.js',
	summary: 'durable triage state for start / resume / status',
	usage: [
		'--triage-id <id> --init --test-key <key> [--branch b] [--lookback-days n] [--phase p] [--force]',
		'--triage-id <id> --read | --validate',
		'--triage-id <id> --set phase=hypothesis-ready --set selectedPattern=A',
		"--triage-id <id> --patch '<json>'",
		"--triage-id <id> --patch-pattern A --patch '{\"note\": \"...\"}'",
		'--status',
	],
	flags: [
		{ name: 'triage-id', value: '<id>', description: 'work-dir id; required for everything except --status' },
		{ name: 'init', type: 'boolean', description: "create state; seeds history/patterns from this triage's history-summary.json if present" },
		{ name: 'test-key', value: '<key>', description: 'testName|||specPath; required with --init' },
		{ name: 'branch', value: '<branch>', description: 'branch recorded on the checkpoint' },
		{ name: 'lookback-days', value: '<n>', description: 'lookback recorded on the checkpoint' },
		{ name: 'phase', value: '<p>', description: `with --init, start somewhere other than ${'awaiting-pattern-selection'} (done is rejected)` },
		{ name: 'force', type: 'boolean', description: 'allow --init to clobber an existing checkpoint' },
		{ name: 'read', type: 'boolean', description: 'print state (plus _validation when invalid)' },
		{ name: 'validate', type: 'boolean', description: 'print { ok, errors[], phase, nextAction } only' },
		{ name: 'set', value: 'key=value', description: 'set one scalar; repeatable' },
		{ name: 'patch', value: '<json>', description: 'deep-merge an object; rejects unknown top-level keys' },
		{ name: 'patch-pattern', value: '<id>', description: 'merge --patch into exactly one patterns[] entry' },
		{ name: 'status', type: 'boolean', description: 'list every saved triage' },
	],
});

export const PHASES = [
	'awaiting-pattern-selection',
	'pattern-selected',
	'evidence-gathered',
	'hypothesis-ready',
	'implementation',
	'done',
];

const CHECKPOINT_VERSION = 1;

/**
 * Terminal outcomes a triage can reach, along two axes -- what we found (test
 * vs product) and what we did (fix / file / nothing):
 *   fix-test     -- test bug, fixed in a PR
 *   fix-product  -- product bug, fixed in a PR
 *   file-issue   -- product bug, not fixed now, filed as a new issue
 *   no-op        -- not fixed and not filed (accepted flake, dup of an existing
 *                   issue, backlog note, or handed off); needs a stated reason
 * `phase=done` is gated on one being set, so "done" can't be claimed the moment
 * a fix compiles or a sub-tool (Explore, author-vitest-tests, positron-pr-helper)
 * returns -- the triage still has to declare how it ended and record its
 * diagnosis where it belongs. `outcome` is the PRIMARY artifact; a secondary
 * note (e.g. a backlog mention while fixing the test) does not change it.
 */
export const OUTCOMES = ['fix-test', 'fix-product', 'file-issue', 'no-op'];

/**
 * Top-level scalar fields a `--set key=value` may write. Structural identity
 * fields (version, triageId, testKey) are deliberately excluded so a stray
 * `--set version=2` can't silently corrupt state that validateCheckpoint then
 * rejects on the next read. Object fields (diagnosis, history, ...) go through
 * `--patch`, not `--set`.
 */
export const SETTABLE_FIELDS = new Set([
	'phase', 'nextAction', 'selectedPattern', 'lookbackDays', 'branch',
	'outcome', 'outcomeRef', 'outcomeReason', 'diagnosisBlockRecorded',
]);

/**
 * Every top-level field the state legitimately holds (the initState shape).
 * `--patch` deep-merges, so a top-level key it *introduces* is almost always a
 * nesting mistake: `--patch '{"confidence":"high"}'` meant `diagnosis.confidence`
 * but silently creates a stray top-level `confidence` the renderer never reads.
 * `applyMutations` rejects unknown top-level patch keys so that fails loudly,
 * the same way `--set` rejects unknown fields. Deep keys under a known object
 * (`diagnosis.mechanismMap`) stay free -- the check is top-level only.
 */
export const KNOWN_FIELDS = new Set([
	'version', 'triageId', 'testKey', 'branch', 'lookbackDays', 'phase',
	'history', 'patterns', 'selectedPattern', 'priorTriage', 'evidence',
	'diagnosis', 'outcome', 'outcomeRef', 'outcomeReason',
	'diagnosisBlockRecorded', 'nextAction', 'updatedAt',
]);

/**
 * Default next action for each phase. Advancing `phase` without also setting
 * `nextAction` would otherwise leave the init default stale, so a resume would
 * print a misleading step. `--set phase=X` derives the matching next action
 * unless `nextAction` is set in the same invocation.
 */
export const PHASE_NEXT_ACTION = {
	'awaiting-pattern-selection': 'Run the history helper, then select a failure pattern.',
	'pattern-selected': 'Fetch evidence for the selected pattern\'s representative occurrence.',
	'evidence-gathered': 'Reason through the evidence to a root-cause mechanism.',
	'hypothesis-ready': 'Reproduce and verify the fix (diagnosis saved).',
	'implementation': 'Implement + verify the fix (no single-green-run claims for a flake), then set an outcome and record the diagnosis block (record-diagnosis.js) before phase=done.',
	'done': 'Triage complete; diagnosis recorded.',
};

export function defaultNextAction(phase) {
	return PHASE_NEXT_ACTION[phase] || null;
}

/**
 * Phases retired from PHASES, mapped to what they now mean. Kept so a checkpoint
 * written before the retirement still loads instead of failing validation on a
 * phase the engineer never chose.
 *
 * `awaiting-clear` predates delegating evidence reads to subagents: the skill
 * used to park here and ask for a /clear before implementing. It no longer
 * proposes one, so the state it parked in is just hypothesis-ready.
 */
export const RETIRED_PHASES = { 'awaiting-clear': 'hypothesis-ready' };

/** Normalize a checkpoint read from disk. Pure -- returns a new state. */
export function migrateState(state) {
	const to = RETIRED_PHASES[state?.phase];
	if (!to) { return state; }
	return { ...state, phase: to, nextAction: defaultNextAction(to) };
}

/**
 * Apply a `--patch` object and any number of `--set key=value` pairs to state.
 * When `phase` changes but `nextAction` is not set in the same call, derive
 * `nextAction` from the new phase. Pure -- returns a new state, no I/O.
 *
 * @param {object} state
 * @param {object|null} patch
 * @param {Array<[string,string]>} sets  raw [key, rawValue] pairs (values coerced here)
 */
export function applyMutations(state, patch, sets = []) {
	const touched = new Set();
	let next = state;
	if (patch) {
		const unknown = Object.keys(patch).filter(k => !KNOWN_FIELDS.has(k));
		if (unknown.length) {
			throw new Error(`--patch introduced unknown top-level field(s): ${unknown.join(', ')}. ` +
				`Nest under a known object (e.g. {"diagnosis": {"${unknown[0]}": ...}}) or use --set for a scalar. ` +
				`Known: ${[...KNOWN_FIELDS].join(', ')}.`);
		}
		next = applyPatch(next, patch);
		for (const k of Object.keys(patch)) { touched.add(k); }
	}
	next = { ...next };
	for (const [k, rawV] of sets) {
		if (!SETTABLE_FIELDS.has(k)) {
			throw new Error(`--set ${k} is not a mutable field (allowed: ${[...SETTABLE_FIELDS].join(', ')}; object fields use --patch).`);
		}
		next[k] = coerce(rawV);
		touched.add(k);
	}
	if (touched.has('phase') && !touched.has('nextAction') && defaultNextAction(next.phase)) {
		next.nextAction = defaultNextAction(next.phase);
	}
	return next;
}

/**
 * Gate reaching `phase=done`. A triage is only "done" once it has declared how
 * it ended (`outcome`) and, for outcomes that produce an external artifact,
 * recorded its diagnosis block there. This is the mechanical guard that stops
 * `done` from firing after a fix verifies but before the block is on the PR.
 * Returns { ok, errors[] }.
 */
export function checkDoneGate(state) {
	const errors = [];
	if (!OUTCOMES.includes(state.outcome)) {
		errors.push(`phase=done requires an outcome. Set --set outcome=${OUTCOMES.join('|')}.`);
		return { ok: false, errors };
	}
	if (state.outcome === 'no-op') {
		if (!state.outcomeReason) {
			errors.push('outcome=no-op requires --set outcomeReason="<why the triage ends without a PR/issue>".');
		}
	} else {
		// fix-test | fix-product | file-issue: an external artifact carries the block.
		if (!state.outcomeRef) {
			errors.push(`outcome=${state.outcome} requires outcomeRef (the PR/issue). Run record-diagnosis.js --pr <n> (or --issue <n>); it sets this.`);
		}
		if (state.diagnosisBlockRecorded !== true) {
			errors.push('diagnosis block not recorded. Run record-diagnosis.js --triage-id <id> --pr <n> (or --issue <n>) to append the E2E Triage Diagnosis block; it sets diagnosisBlockRecorded.');
		}
	}
	return { ok: errors.length === 0, errors };
}

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

/**
 * Merge a partial object into exactly ONE pattern (matched by id) inside the
 * `patterns` array, leaving every other pattern untouched. A top-level
 * `--patch '{"patterns": [...]}'` replaces the whole array (per applyPatch's
 * array-replace rule above) -- a real footgun for annotating a single pattern,
 * since it silently drops every other pattern's data unless the caller
 * reconstructs and resends the full array. This is the safe path for that.
 */
export function mergePatternPatch(patterns, patternId, patch) {
	const list = Array.isArray(patterns) ? patterns : [];
	const idx = list.findIndex(p => p.id === patternId);
	if (idx === -1) {
		const have = list.map(p => p.id).join(', ') || 'none';
		throw new Error(`No pattern with id "${patternId}" in this checkpoint (have: ${have}).`);
	}
	const merged = applyPatch(list[idx], patch);
	return list.map((p, i) => i === idx ? merged : p);
}

/**
 * Seed `history` + `patterns` from the on-disk `history-summary.json` that
 * `triage-history.js` already wrote to this triage's work dir. Makes `--init`
 * actually record the patterns (as the skill's workflow describes) instead of
 * requiring a separate manual `--patch` of the full `patterns` array -- which
 * is exactly the step where the array-replace footgun above bites.
 */
export function applyHistorySummary(state, summary) {
	if (!summary || !Array.isArray(summary.patterns)) { return state; }
	return {
		...state,
		history: { branchSummary: summary.branchSummary, verdict: summary.verdict },
		patterns: summary.patterns,
	};
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

/**
 * Starting phase for a fresh checkpoint. The CI entry always begins at
 * `awaiting-pattern-selection` (its next step is the pattern table), but the
 * local entry has no patterns to select and only checkpoints at all once it
 * escalates -- by which point evidence is already in hand. `--init --phase` lets
 * it start where it actually is instead of advancing through phases it skipped.
 */
export function initialPhase(requested) {
	if (!requested) { return 'awaiting-pattern-selection'; }
	if (!PHASES.includes(requested)) {
		throw new Error(`--phase "${requested}" is not a known phase (${PHASES.join(', ')}).`);
	}
	if (requested === 'done') {
		throw new Error('--init --phase done is not allowed: phase=done goes through the outcome gate, not an init.');
	}
	return requested;
}

function newState(triageId, args) {
	const phase = initialPhase(args.phase);
	return {
		version: CHECKPOINT_VERSION,
		triageId,
		testKey: args['test-key'] || null,
		branch: args.branch || null,
		lookbackDays: Number(args['lookback-days'] || 14),
		phase,
		history: null,
		patterns: [],
		selectedPattern: null,
		priorTriage: { status: 'unknown' },
		evidence: null,
		diagnosis: null,
		outcome: null,
		outcomeRef: null,
		outcomeReason: null,
		diagnosisBlockRecorded: false,
		nextAction: PHASE_NEXT_ACTION[phase],
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
	handleHelp(CLI, process.argv.slice(2));
	const args = parseArgs(process.argv.slice(2), CLI.booleanFlags);

	if (args.status) { emit(statusAll()); return; }

	const triageId = args['triage-id'];
	if (!triageId) { fail('Missing --triage-id (or use --status).'); }
	const sp = statePath(triageId);

	if (args.init) {
		if (fs.existsSync(sp) && !args.force) {
			// Refuse to clobber a triage in progress; resume it, or pass --force to reset.
			fail(`A checkpoint for triage "${triageId}" already exists -- resume it (--read) or pass --force to overwrite.`, { stateFile: path.relative(process.cwd(), sp) });
		}
		ensureDir(triageDir(triageId));
		let state;
		try { state = newState(triageId, args); }
		catch (e) { fail(e.message); }
		// Auto-seed history + patterns from triage-history.js's already-written
		// summary, if present -- see applyHistorySummary's doc comment.
		const historyFile = path.join(triageDir(triageId), 'history-summary.json');
		if (fs.existsSync(historyFile)) {
			try { state = applyHistorySummary(state, readJson(historyFile)); }
			catch { /* malformed summary file -- leave state as a bare init rather than failing */ }
		}
		writeJson(sp, state);
		emit({ ...state, stateFile: path.relative(process.cwd(), sp) });
		return;
	}

	if (!fs.existsSync(sp)) { fail(`No checkpoint for triage "${triageId}" (run --init first).`); }
	let state = migrateState(readJson(sp));

	if (args.read || args.validate) {
		const v = validateCheckpoint(state);
		if (args.validate) { emit({ ...v, phase: state.phase, nextAction: state.nextAction }); return; }
		if (!v.ok) { emit({ ...state, _validation: v, stateFile: path.relative(process.cwd(), sp) }); return; }
		emit({ ...state, stateFile: path.relative(process.cwd(), sp) });
		return;
	}

	// Mutations: --patch and/or repeated --set key=value, or --patch-pattern <id>
	// to merge into just one pattern (see mergePatternPatch's doc comment).
	let patch = null;
	if (args.patch) {
		try { patch = JSON.parse(args.patch); } catch { fail('--patch must be valid JSON.'); }
	}
	// parseArgs keeps only the last --set; collect all --set occurrences manually.
	const sets = [];
	const raw = process.argv.slice(2);
	for (let i = 0; i < raw.length; i++) {
		if (raw[i] === '--set' && raw[i + 1]) {
			const [k, ...rest] = raw[i + 1].split('=');
			sets.push([k, rest.join('=')]);
		}
	}

	const patchPatternId = args['patch-pattern'];
	if (!patch && sets.length === 0 && !patchPatternId) {
		fail('Nothing to do (use --init/--read/--set/--patch/--patch-pattern/--status/--validate).');
	}
	if (patchPatternId) {
		if (!patch) { fail('--patch-pattern requires --patch \'<json>\' with the fields to merge into that one pattern.'); }
		try { state = { ...state, patterns: mergePatternPatch(state.patterns, patchPatternId, patch) }; }
		catch (e) { fail(e.message); }
		patch = null; // consumed by the single-pattern merge, not a top-level patch
	}
	try {
		state = applyMutations(state, patch, sets);
	} catch (e) {
		fail(e.message);
	}

	// Gate the terminal phase: refuse to persist phase=done until the triage has
	// declared an outcome and recorded its diagnosis block (for PR/issue outcomes).
	if (state.phase === 'done') {
		const gate = checkDoneGate(state);
		if (!gate.ok) {
			fail('phase=done blocked by the outcome gate.', { gate, phase: state.phase, outcome: state.outcome });
		}
	}

	state.updatedAt = new Date().toISOString();
	writeJson(sp, state);
	emit({ ...state, stateFile: path.relative(process.cwd(), sp) });
}

if (isMain(import.meta.url)) { main(); }
