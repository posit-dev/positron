/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Offline analysis for console-execution latency traces.
 *
 * Reads the JSONL/log files a trace run produces, joins events across the five
 * emitting processes, and writes a timeline, a stage-duration table, a grouped
 * summary, and a gaps report. Zero dependencies, and Node strips the types, so a
 * timing investigation does not depend on the same build pipeline it is
 * measuring.
 *
 * The `.mts` extension and the `.ts` import specifier are what keep that true,
 * the same way `scripts/format.mts` runs. `test/e2e/tsconfig.json` excludes this
 * file because the emitting project rejects that specifier, and going through
 * `out/` would put a build between a trace and its report.
 *
 * Usage: node test/e2e/utils/perf-trace/analyze.mts <trace-dir> [--out <dir>]
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { STAGES, TraceName, type TraceEvent, type TraceIds, type TraceProc } from './schema.ts';

type AttributedEvent = {
	event: TraceEvent;
	attribution: 'id_attributed' | 'time_attributed';
};

type Sample = {
	sampleId: string;
	events: AttributedEvent[];
	idSpace: Set<string>;
	lspSpace: Set<string>;
};

type Counters = { malformed: number };

type StageRow = {
	sampleId: string;
	language: string;
	variant: string;
	stage: string;
	durationMs: number | undefined;
	exactApprox: 'exact' | 'approx' | '';
	flags: string[];
	fromCount: number;
	toCount: number;
};

type NumericStageRow = StageRow & { durationMs: number };

type ClockAlignment = {
	key: string;
	count: number;
	offsetUs: number;
	driftUs: number | undefined;
};

type GapsContext = {
	samples: Map<string, Sample>;
	unattributed: { event: TraceEvent; reason: string }[];
	allRows: StageRow[];
	malformed: number;
	malformedByFile: Map<string, number>;
	clockAlignment: ClockAlignment[];
};

const CLOCK_PAIR_NAME = TraceName.clockPair;
const KEYDOWN_NAME = TraceName.renderer.enterKeydown;
const VALID_PROCS = new Set<TraceProc>(['harness', 'renderer', 'exthost', 'ark']);

/**
 * The id fields that share one namespace, because `ExecuteRequest` reuses
 * Positron's execution id as the Jupyter `msg_id`.
 */
const JOINED_ID_FIELDS = ['execution_id', 'jupyter_msg_id', 'parent_msg_id'] as const;

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Extracts the balanced `{...}` object following `marker` in `line`.
 *
 * A greedy end-of-line regex would swallow trailing log text into the JSON
 * string; scanning brace depth (skipping braces inside quoted strings) finds
 * the true end regardless of what the tracing pretty-formatter appends.
 */
function extractJsonAfter(line: string, marker: string): string | undefined {
	const markerIdx = line.indexOf(marker);
	if (markerIdx === -1) {
		return undefined;
	}
	const braceStart = line.indexOf('{', markerIdx + marker.length);
	if (braceStart === -1) {
		return undefined;
	}
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let i = braceStart; i < line.length; i++) {
		const ch = line[i];
		if (inString) {
			if (escaped) {
				escaped = false;
			} else if (ch === '\\') {
				escaped = true;
			} else if (ch === '"') {
				inString = false;
			}
			continue;
		}
		if (ch === '"') {
			inString = true;
		} else if (ch === '{') {
			depth++;
		} else if (ch === '}') {
			depth--;
			if (depth === 0) {
				return line.slice(braceStart, i + 1);
			}
		}
	}
	return undefined;
}

function isValidEvent(obj: unknown): obj is TraceEvent {
	if (typeof obj !== 'object' || obj === null) {
		return false;
	}
	const event = obj as Partial<TraceEvent>;
	return typeof event.v === 'number'
		&& typeof event.run_id === 'string'
		&& typeof event.proc === 'string' && VALID_PROCS.has(event.proc)
		&& typeof event.pid === 'number'
		&& typeof event.name === 'string'
		&& typeof event.t_mono_us === 'number'
		&& typeof event.t_wall_us === 'number';
}

function readJsonlFile(filePath: string, counters: Counters): TraceEvent[] {
	const events = [];
	const text = readFileSync(filePath, 'utf8');
	for (const line of text.split('\n')) {
		const trimmed = line.trim();
		if (trimmed === '') {
			continue;
		}
		let obj;
		try {
			obj = JSON.parse(trimmed);
		} catch {
			counters.malformed++;
			continue;
		}
		if (!isValidEvent(obj)) {
			counters.malformed++;
			continue;
		}
		events.push(obj);
	}
	return events;
}

/**
 * Ark markers ride inside ordinary tracing-formatted log lines. Every other
 * line in the file is ignored, not counted as malformed: only lines that
 * carry the marker but fail to yield a valid event count against the total.
 */
function readLogFile(filePath: string, counters: Counters): TraceEvent[] {
	const events = [];
	const text = readFileSync(filePath, 'utf8');
	for (const line of text.split('\n')) {
		if (!line.includes('PERFTRACE')) {
			continue;
		}
		const jsonText = extractJsonAfter(line, 'PERFTRACE');
		if (jsonText === undefined) {
			counters.malformed++;
			continue;
		}
		let obj;
		try {
			obj = JSON.parse(jsonText);
		} catch {
			counters.malformed++;
			continue;
		}
		if (!isValidEvent(obj)) {
			counters.malformed++;
			continue;
		}
		events.push(obj);
	}
	return events;
}

function loadAllEvents(traceDir: string): { events: TraceEvent[]; malformed: number; malformedByFile: Map<string, number> } {
	const counters: Counters = { malformed: 0 };
	const malformedByFile = new Map();
	const events = [];
	const entries = readdirSync(traceDir, { withFileTypes: true })
		.filter(d => d.isFile())
		.map(d => d.name)
		.sort();
	for (const name of entries) {
		const filePath = join(traceDir, name);
		const before = counters.malformed;
		if (/^harness-.*\.jsonl$/.test(name) || /^exthost-.*\.jsonl$/.test(name)) {
			events.push(...readJsonlFile(filePath, counters));
		} else if (/\.log$/.test(name)) {
			events.push(...readLogFile(filePath, counters));
		} else {
			continue;
		}
		if (counters.malformed > before) {
			malformedByFile.set(name, counters.malformed - before);
		}
	}
	return { events, malformed: counters.malformed, malformedByFile };
}

// ---------------------------------------------------------------------------
// Correlation
// ---------------------------------------------------------------------------

function normId(v: string | number | undefined | null) {
	return v === undefined || v === null ? undefined : String(v);
}

/** Adds the ids an event carries to its sample's join sets. */
function addIdsToSpace(sample: Sample, event: TraceEvent) {
	const ids = event.ids;
	if (!ids) {
		return;
	}
	for (const field of JOINED_ID_FIELDS) {
		const v = normId(ids[field]);
		if (v !== undefined) {
			sample.idSpace.add(v);
		}
	}
	const lsp = normId(ids.lsp_request_id);
	if (lsp !== undefined) {
		sample.lspSpace.add(lsp);
	}
}

function eventJoinsSample(event: TraceEvent, sample: Sample): boolean {
	const ids = event.ids;
	if (!ids) {
		return false;
	}
	for (const field of JOINED_ID_FIELDS) {
		const v = normId(ids[field]);
		if (v !== undefined && sample.idSpace.has(v)) {
			return true;
		}
	}
	const lsp = normId(ids.lsp_request_id);
	return lsp !== undefined && sample.lspSpace.has(lsp);
}

/**
 * Groups events by sample and attributes the ones that cannot be joined
 * directly (ark and exthost carry no `sample_id`).
 */
function buildSamples(events: TraceEvent[]): { samples: Map<string, Sample>; unattributed: { event: TraceEvent; reason: string }[] } {
	const samples = new Map<string, Sample>();
	const direct: { event: TraceEvent; sampleId: string }[] = [];
	const rest: TraceEvent[] = [];
	for (const event of events) {
		const sampleId = event.ids?.sample_id;
		if (sampleId) {
			direct.push({ event, sampleId });
		} else {
			rest.push(event);
		}
	}
	for (const { event, sampleId } of direct) {
		let sample = samples.get(sampleId);
		if (!sample) {
			sample = { sampleId, events: [], idSpace: new Set(), lspSpace: new Set() };
			samples.set(sampleId, sample);
		}
		sample.events.push({ event, attribution: 'id_attributed' });
		addIdsToSpace(sample, event);
	}

	// Fixed-point pass: an ark/exthost event that joins can itself introduce
	// ids (e.g. an iopub reply's own msg_id) that let a later sibling join too.
	const pending = new Set(rest);
	const ambiguousIdEvents = [];
	let changed = true;
	while (changed) {
		changed = false;
		for (const e of Array.from(pending)) {
			const matches = [];
			for (const sample of samples.values()) {
				if (eventJoinsSample(e, sample)) {
					matches.push(sample);
				}
			}
			if (matches.length === 1) {
				matches[0].events.push({ event: e, attribution: 'id_attributed' });
				addIdsToSpace(matches[0], e);
				pending.delete(e);
				changed = true;
			} else if (matches.length > 1) {
				ambiguousIdEvents.push(e);
				pending.delete(e);
			}
		}
	}

	// Time-attribution fallback: containment within the sample's own
	// id-joined wall interval. Deliberately conservative -- an event whose
	// timestamp falls in more than one sample's interval joins neither,
	// since guessing wrong here is worse than leaving it unattributed.
	const wallIntervals = new Map();
	for (const sample of samples.values()) {
		// Folded rather than spread: a large-output sample carries enough events
		// to exceed the argument limit.
		let lo = Infinity;
		let hi = -Infinity;
		for (const { event } of sample.events) {
			lo = Math.min(lo, event.t_wall_us);
			hi = Math.max(hi, event.t_wall_us);
		}
		wallIntervals.set(sample.sampleId, [lo, hi]);
	}
	const unattributed = [];
	for (const e of pending) {
		const containing = [];
		for (const sample of samples.values()) {
			const [lo, hi] = wallIntervals.get(sample.sampleId);
			if (e.t_wall_us >= lo && e.t_wall_us <= hi) {
				containing.push(sample);
			}
		}
		if (containing.length === 1) {
			containing[0].events.push({ event: e, attribution: 'time_attributed' });
		} else if (containing.length === 0) {
			unattributed.push({ event: e, reason: 'no_join' });
		} else {
			unattributed.push({ event: e, reason: 'ambiguous_time_containment' });
		}
	}
	for (const e of ambiguousIdEvents) {
		unattributed.push({ event: e, reason: 'ambiguous_id_match' });
	}

	return { samples, unattributed };
}

// ---------------------------------------------------------------------------
// Stage computation
// ---------------------------------------------------------------------------

/**
 * Picks the first occurrence of `from`, then the first occurrence of `to` at
 * or after it, per stage. Never sums repeats and never substitutes a nearby
 * event for a missing endpoint.
 */
function computeStages(sample: Sample): StageRow[] {
	const rows = [];
	for (const spec of STAGES) {
		const fromOccs = sample.events
			.filter(x => x.event.name === spec.from)
			.sort((a, b) => a.event.t_wall_us - b.event.t_wall_us);
		const toOccsAll = sample.events
			.filter(x => x.event.name === spec.to)
			.sort((a, b) => a.event.t_wall_us - b.event.t_wall_us);

		const flags = new Set<string>();
		if (fromOccs.length === 0) {
			flags.add('missing_from');
		}
		if (fromOccs.length > 1 || toOccsAll.length > 1) {
			flags.add('ambiguous');
		}

		let fromEntry: AttributedEvent | undefined;
		let toEntry: AttributedEvent | undefined;
		if (fromOccs.length > 0) {
			const first = fromOccs[0];
			fromEntry = first;
			const toAfter = toOccsAll.filter(x => x.event.t_wall_us >= first.event.t_wall_us);
			if (toAfter.length > 0) {
				toEntry = toAfter[0];
			}
		}
		if (!toEntry) {
			flags.add('missing_to');
		}

		let durationMs;
		let exactApprox: 'exact' | 'approx' | '' = '';
		if (fromEntry && toEntry) {
			if (fromEntry.attribution === 'time_attributed' || toEntry.attribution === 'time_attributed') {
				flags.add('time_attributed');
			}
			if (spec.same_process) {
				if (fromEntry.event.proc === toEntry.event.proc && fromEntry.event.pid === toEntry.event.pid) {
					durationMs = (toEntry.event.t_mono_us - fromEntry.event.t_mono_us) / 1000;
					exactApprox = 'exact';
				} else {
					flags.add('proc_mismatch');
				}
			} else {
				durationMs = (toEntry.event.t_wall_us - fromEntry.event.t_wall_us) / 1000;
				exactApprox = 'approx';
			}
			if (durationMs !== undefined && durationMs < 0) {
				flags.add('negative');
			}
		}

		rows.push({
			sampleId: sample.sampleId,
			language: '',
			variant: '',
			stage: spec.stage,
			durationMs,
			exactApprox,
			flags: Array.from(flags),
			fromCount: fromOccs.length,
			toCount: toOccsAll.length,
		});
	}
	return rows;
}

/**
 * Prefers `language`/`variant` on a harness event's `attrs` when present;
 * otherwise parses the sample id, which has the form
 * `<test-title-slug>-r<repeatIndex>`. The slug has no reserved separator for
 * a variant token, so absent attrs, `variant` falls back to the full slug.
 */
function sampleLanguageVariant(sample: Sample): { language: string; variant: string } {
	for (const { event } of sample.events) {
		if (event.proc === 'harness' && event.attrs) {
			const lang = event.attrs.language;
			const variant = event.attrs.variant;
			if (typeof lang === 'string' || typeof variant === 'string') {
				return {
					language: typeof lang === 'string' ? lang : 'unknown',
					variant: typeof variant === 'string' ? variant : 'unknown',
				};
			}
		}
	}
	const slug = sample.sampleId.replace(/-r\d+$/, '');
	const langMatch = slug.match(/(?:^|-)(python|r)(?:-|$)/);
	return { language: langMatch ? langMatch[1] : 'unknown', variant: slug };
}

// ---------------------------------------------------------------------------
// Clock alignment
// ---------------------------------------------------------------------------

function computeClockAlignment(events: TraceEvent[]): ClockAlignment[] {
	const groups = new Map<string, TraceEvent[]>();
	for (const e of events) {
		if (e.name !== CLOCK_PAIR_NAME) {
			continue;
		}
		const key = `${e.proc}:${e.pid}`;
		let list = groups.get(key);
		if (!list) {
			list = [];
			groups.set(key, list);
		}
		list.push(e);
	}
	const report = [];
	for (const [key, list] of Array.from(groups).sort((a, b) => a[0].localeCompare(b[0]))) {
		list.sort((a, b) => a.t_mono_us - b.t_mono_us);
		const offsets = list.map(e => e.t_wall_us - e.t_mono_us);
		const first = offsets[0];
		const last = offsets[offsets.length - 1];
		report.push({
			key,
			count: list.length,
			offsetUs: first,
			driftUs: list.length > 1 ? (last - first) : undefined,
		});
	}
	return report;
}

// ---------------------------------------------------------------------------
// Output: timeline-<sample_id>.txt
// ---------------------------------------------------------------------------

function padEndTo(s: string, width: number) {
	return s.length >= width ? s : s.padEnd(width);
}

function padStartTo(s: string, width: number) {
	return s.length >= width ? s : s.padStart(width);
}

function formatWallTime(tWallUs: number) {
	const epochMs = Math.floor(tWallUs / 1000);
	const microRemainder = tWallUs - epochMs * 1000;
	const d = new Date(epochMs);
	const hh = String(d.getHours()).padStart(2, '0');
	const mm = String(d.getMinutes()).padStart(2, '0');
	const ss = String(d.getSeconds()).padStart(2, '0');
	const millis = String(d.getMilliseconds()).padStart(3, '0');
	const micros = String(microRemainder).padStart(3, '0');
	return `${hh}:${mm}:${ss}.${millis}${micros}`;
}

function formatIds(ids: TraceIds | undefined) {
	if (!ids) {
		return '-';
	}
	const parts = [];
	for (const [k, v] of Object.entries(ids)) {
		if (v !== undefined && v !== null) {
			parts.push(`${k}=${v}`);
		}
	}
	return parts.length ? parts.join(' ') : '-';
}

function buildTimeline(sample: Sample): string {
	const rows = [...sample.events].sort((a, b) => a.event.t_wall_us - b.event.t_wall_us);
	const keydown = rows.find(x => x.event.name === KEYDOWN_NAME);
	const header = [
		padEndTo('wall_time', 17),
		padStartTo('d_prev_ms', 10),
		padStartTo('d_keydown_ms', 12),
		padEndTo('proc', 9),
		padStartTo('pid', 7),
		padEndTo('thread', 8),
		padEndTo('name', 40),
		padEndTo('ids', 50),
		padEndTo('attrs', 24),
		'attrib',
	].join(' ');
	const lines = [header];
	let prev;
	for (const row of rows) {
		const e = row.event;
		const wall = formatWallTime(e.t_wall_us);
		const dPrev = prev ? ((e.t_wall_us - prev.t_wall_us) / 1000).toFixed(3) : '-';
		const dKey = keydown ? ((e.t_wall_us - keydown.event.t_wall_us) / 1000).toFixed(3) : '-';
		const attrsStr = e.attrs ? JSON.stringify(e.attrs) : '-';
		lines.push([
			padEndTo(wall, 17),
			padStartTo(dPrev, 10),
			padStartTo(dKey, 12),
			padEndTo(e.proc, 9),
			padStartTo(String(e.pid), 7),
			padEndTo(e.thread ?? '-', 8),
			padEndTo(e.name, 40),
			padEndTo(formatIds(e.ids), 50),
			padEndTo(attrsStr, 24),
			row.attribution === 'id_attributed' ? 'id' : 'time',
		].join(' '));
		prev = e;
	}
	return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Output: stages.csv
// ---------------------------------------------------------------------------

function csvEscape(v: string | number) {
	const s = String(v);
	if (/[",\n]/.test(s)) {
		return `"${s.replace(/"/g, '""')}"`;
	}
	return s;
}

function writeStagesCsv(outDir: string, rows: StageRow[]) {
	const lines = ['sample_id,language,variant,stage,duration_ms,exact_or_approx,flags'];
	for (const r of rows) {
		lines.push([
			csvEscape(r.sampleId),
			csvEscape(r.language),
			csvEscape(r.variant),
			csvEscape(r.stage),
			r.durationMs === undefined ? '' : r.durationMs.toFixed(3),
			csvEscape(r.exactApprox),
			csvEscape(r.flags.join(';')),
		].join(','));
	}
	writeFileSync(join(outDir, 'stages.csv'), lines.join('\n') + '\n');
}

// ---------------------------------------------------------------------------
// Output: summary.md
// ---------------------------------------------------------------------------

function median(nums: number[]) {
	const sorted = [...nums].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function mean(nums: number[]) {
	return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function hasDuration(row: StageRow): row is NumericStageRow {
	return row.durationMs !== undefined;
}

function summarizeFlags(rows: StageRow[]) {
	const counts = new Map();
	for (const r of rows) {
		for (const f of r.flags) {
			counts.set(f, (counts.get(f) ?? 0) + 1);
		}
	}
	if (counts.size === 0) {
		return 'no data';
	}
	return Array.from(counts.entries()).map(([f, c]) => `${f} x${c}`).join(', ');
}

function writeSummary(outDir: string, allRows: StageRow[]) {
	const groups = new Map<string, { language: string; variant: string; stages: Map<string, StageRow[]> }>();
	for (const r of allRows) {
		const key = `${r.language} ${r.variant}`;
		let g = groups.get(key);
		if (!g) {
			g = { language: r.language, variant: r.variant, stages: new Map() };
			groups.set(key, g);
		}
		let stage = g.stages.get(r.stage);
		if (!stage) {
			stage = [];
			g.stages.set(r.stage, stage);
		}
		stage.push(r);
	}

	const lines = ['# Console execution latency summary', ''];
	for (const g of Array.from(groups.values()).sort((a, b) =>
		(a.language + a.variant).localeCompare(b.language + b.variant))) {
		lines.push(`## ${g.language} / ${g.variant}`, '');
		for (const spec of STAGES) {
			const rows = g.stages.get(spec.stage) ?? [];
			const numeric = rows.filter(hasDuration);
			lines.push(`### ${spec.stage}`, '');
			if (numeric.length === 0) {
				lines.push(`No numeric samples (${summarizeFlags(rows)}).`, '');
				continue;
			}
			const vals = numeric.map(r => r.durationMs);
			if (numeric.length < 3) {
				lines.push(`n=${numeric.length} -- fewer than 3 samples, median/mean not reported as stable.`, '');
			} else {
				lines.push(
					`n=${numeric.length}  median=${median(vals).toFixed(3)}ms  mean=${mean(vals).toFixed(3)}ms  ` +
					`min=${Math.min(...vals).toFixed(3)}ms  max=${Math.max(...vals).toFixed(3)}ms`,
					'',
				);
			}
			lines.push('Raw values:', '');
			for (const r of numeric) {
				const flagStr = r.flags.length ? ` [${r.flags.join(';')}]` : '';
				lines.push(`- ${r.sampleId}: ${r.durationMs.toFixed(3)}ms${flagStr}`);
			}
			lines.push('');
		}
	}
	writeFileSync(join(outDir, 'summary.md'), lines.join('\n') + '\n');
}

// ---------------------------------------------------------------------------
// Output: gaps.md
// ---------------------------------------------------------------------------

function writeGaps(outDir: string, ctx: GapsContext) {
	const { samples, unattributed, allRows, malformed, malformedByFile, clockAlignment } = ctx;
	const lines = ['# Gaps and uncertainty', ''];

	lines.push('## Unparseable lines', '');
	if (malformedByFile.size === 0) {
		lines.push('None.', '');
	} else {
		for (const [file, count] of malformedByFile) {
			lines.push(`- ${file}: ${count}`);
		}
		lines.push(`- total: ${malformed}`, '');
	}

	lines.push('## Clock alignment', '');
	lines.push(
		'Offset is t_wall_us minus t_mono_us at a clock.pair, in microseconds. Drift is the ' +
		'change in offset between the first and last clock.pair on that process/pid, and is the ' +
		'uncertainty attached to every cross-process (approx) stage above and beyond its own value.',
		'',
	);
	if (clockAlignment.length === 0) {
		lines.push('No clock.pair events found.', '');
	} else {
		for (const c of clockAlignment) {
			const driftStr = c.driftUs === undefined ? 'n/a (single pair)' : `${c.driftUs}us`;
			lines.push(`- ${c.key}: pairs=${c.count} offset=${c.offsetUs}us drift=${driftStr}`);
		}
		lines.push('');
	}

	lines.push('## Unattributed events', '');
	lines.push(`Count: ${unattributed.length}`, '');
	const byReason = new Map();
	for (const u of unattributed) {
		const key = `${u.reason} / ${u.event.name}`;
		byReason.set(key, (byReason.get(key) ?? 0) + 1);
	}
	if (byReason.size === 0) {
		lines.push('None.', '');
	} else {
		for (const [key, count] of byReason) {
			lines.push(`- ${key}: ${count}`);
		}
		lines.push('');
	}

	lines.push('## Samples missing expected events', '');
	const allNames = new Set<string>();
	for (const spec of STAGES) {
		allNames.add(spec.from);
		allNames.add(spec.to);
	}
	let anyMissing = false;
	for (const sample of Array.from(samples.values()).sort((a, b) => a.sampleId.localeCompare(b.sampleId))) {
		const seen = new Set(sample.events.map(x => x.event.name));
		const missing = Array.from(allNames).filter(n => !seen.has(n));
		if (missing.length > 0) {
			anyMissing = true;
			lines.push(`- ${sample.sampleId}: missing ${missing.join(', ')}`);
		}
	}
	if (!anyMissing) {
		lines.push('None.');
	}
	lines.push('');

	lines.push('## Stages with no number', '');
	const noNumber = allRows.filter(r => r.durationMs === undefined);
	if (noNumber.length === 0) {
		lines.push('None.', '');
	} else {
		for (const r of noNumber) {
			lines.push(`- ${r.sampleId} / ${r.stage}: ${r.flags.join(';') || 'unknown'} (from_count=${r.fromCount} to_count=${r.toCount})`);
		}
		lines.push('');
	}

	lines.push('## Ambiguous endpoints', '');
	const ambiguous = allRows.filter(r => r.flags.includes('ambiguous'));
	if (ambiguous.length === 0) {
		lines.push('None.', '');
	} else {
		for (const r of ambiguous) {
			lines.push(`- ${r.sampleId} / ${r.stage}: from_count=${r.fromCount} to_count=${r.toCount}`);
		}
		lines.push('');
	}

	lines.push('## Negative durations', '');
	const negative = allRows.filter(hasDuration).filter(r => r.flags.includes('negative'));
	if (negative.length === 0) {
		lines.push('None.', '');
	} else {
		for (const r of negative) {
			lines.push(`- ${r.sampleId} / ${r.stage}: ${r.durationMs.toFixed(3)}ms`);
		}
		lines.push('');
	}

	lines.push('## time_attributed', '');
	let timeAttributedEvents = 0;
	for (const sample of samples.values()) {
		timeAttributedEvents += sample.events.filter(x => x.attribution === 'time_attributed').length;
	}
	const timeAttributedStages = allRows.filter(r => r.flags.includes('time_attributed'));
	lines.push(`Events attached by wall-clock containment rather than id: ${timeAttributedEvents}`);
	lines.push(`Stages with a time_attributed endpoint: ${timeAttributedStages.length}`, '');

	writeFileSync(join(outDir, 'gaps.md'), lines.join('\n') + '\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]) {
	const args = argv.slice(2);
	if (args.length === 0) {
		console.error('usage: node analyze.mts <trace-dir> [--out <dir>]');
		process.exit(1);
	}
	const traceDir = args[0];
	let outDir;
	for (let i = 1; i < args.length; i++) {
		if (args[i] === '--out') {
			outDir = args[i + 1];
			i++;
		}
	}
	return { traceDir, outDir: outDir ?? join(traceDir, 'analysis') };
}

function main() {
	const { traceDir, outDir } = parseArgs(process.argv);
	if (!existsSync(traceDir)) {
		console.error(`trace directory not found: ${traceDir}`);
		process.exit(1);
	}
	mkdirSync(outDir, { recursive: true });

	const { events, malformed, malformedByFile } = loadAllEvents(traceDir);
	const clockAlignment = computeClockAlignment(events);
	const { samples, unattributed } = buildSamples(events);

	const allRows = [];
	for (const sample of Array.from(samples.values()).sort((a, b) => a.sampleId.localeCompare(b.sampleId))) {
		const { language, variant } = sampleLanguageVariant(sample);
		const rows = computeStages(sample).map(r => ({ ...r, language, variant }));
		allRows.push(...rows);
		writeFileSync(join(outDir, `timeline-${sample.sampleId}.txt`), buildTimeline(sample));
	}

	writeStagesCsv(outDir, allRows);
	writeSummary(outDir, allRows);
	writeGaps(outDir, { samples, unattributed, allRows, malformed, malformedByFile, clockAlignment });

	const stagesComputed = allRows.filter(r => r.durationMs !== undefined).length;
	const stagesFlagged = allRows.filter(r => r.flags.length > 0).length;
	console.log(`samples found: ${samples.size}`);
	console.log(`stages computed: ${stagesComputed}`);
	console.log(`stages flagged: ${stagesFlagged}`);

	// A layer whose log never reached the trace directory reports zero here.
	// Read as an absence of events it is indistinguishable from a layer that
	// stayed idle, and every stage crossing it is quietly dropped.
	const byProc = new Map<TraceProc, number>(Array.from(VALID_PROCS, proc => [proc, 0] as const));
	for (const e of events) {
		byProc.set(e.proc, (byProc.get(e.proc) ?? 0) + 1);
	}
	console.log(`events by proc: ${Array.from(byProc, ([proc, n]) => `${proc}=${n}`).join(' ')}`);
	for (const [proc, n] of byProc) {
		if (n === 0) {
			console.log(`WARNING: no ${proc} events found; every stage that crosses ${proc} is missing.`);
		}
	}
	console.log(`output directory: ${outDir}`);
}

main();
