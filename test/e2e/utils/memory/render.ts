/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { deltaHtml, escapeHtml, formatBytes, GC_NOTE, KB, notSteadyStateCardHtml, REPORT_CSS, signed } from './report-shell.js';
import { unstableProcesses } from './snapshot.js';
import { ActivatedExtension, ExtensionHeapBreakdown, ExtensionHeapStatus, LabeledProcess, MemorySnapshot, ProcessRole } from './types.js';

export { formatBytes } from './report-shell.js';

/**
 * Activation events that cost memory in every window, whether or not the user
 * ever touches the feature.
 *
 * `startup: true` on the same log line is VS Code's own notion of a startup
 * activation and is deliberately not used: it also reports extensions that won
 * an activation race during startup, which would put demand-activated
 * extensions in a section whose whole point is what to stop adding.
 */
const EAGER_EVENTS: { event: string; title?: string }[] = [
	// Worst first: `*` runs during startup, so it delays the window rather than only
	// costing memory. Titled because the id says nothing and reads as a footnote
	// marker; `onStartupFinished` describes itself and needs no title.
	{ event: '*', title: 'During startup' },
	{ event: 'onStartupFinished' }
];

export function isEagerActivation(event: string | null): boolean {
	return event !== null && EAGER_EVENTS.some(eager => eager.event === event);
}

/**
 * How many extensions one group lists before collapsing to a count.
 *
 * High enough that a normal run shows everything: the point of the section is
 * the ids, and a reader who has to open the HTML artifact to see them has been
 * given a number instead of a lead. The cap exists only so the summary cannot
 * grow without bound.
 */
const MAX_PER_GROUP = 20;

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/** Median total across launches, which is the headline figure. */
function totalAcrossLaunches(snapshots: MemorySnapshot[]): number {
	return median(snapshots.map(s => s.treeTotalPssBytes));
}

/**
 * Median PSS per role across launches.
 *
 * A role absent from a launch counts as zero for that launch rather than being
 * left out of the median. Skipping it would report an intermittent role from the
 * one launch it appeared in, making something present in 1 of 3 launches look as
 * heavy as something present in all three.
 */
export function byRole(snapshots: MemorySnapshot[]): Map<ProcessRole, number> {
	const perLaunch = snapshots.map(snapshot => {
		const totals = new Map<ProcessRole, number>();
		for (const proc of snapshot.processes) {
			totals.set(proc.processRole, (totals.get(proc.processRole) ?? 0) + proc.pssBytes);
		}
		return totals;
	});

	const roles = new Set(perLaunch.flatMap(totals => [...totals.keys()]));
	return new Map([...roles].map(role => [role, median(perLaunch.map(totals => totals.get(role) ?? 0))]));
}

/**
 * Median PSS per process name across launches, zero-filling a launch that did
 * not have it, for the same reason `byRole` does: a process present in one
 * launch of three should not read as heavy as one present in all three.
 *
 * Keyed on name rather than pid because pids change every launch. The role is
 * carried along for display and taken from the first launch that had the
 * process; a name that resolved to two different roles across launches would be
 * a labeling bug, not something to average.
 */
function byProcessName(snapshots: MemorySnapshot[]): Map<string, { bytes: number; role: ProcessRole }> {
	const perLaunch = snapshots.map(snapshot => {
		const totals = new Map<string, number>();
		for (const proc of snapshot.processes) {
			totals.set(proc.processName, (totals.get(proc.processName) ?? 0) + proc.pssBytes);
		}
		return totals;
	});

	const roles = new Map<string, ProcessRole>();
	for (const snapshot of snapshots) {
		for (const proc of snapshot.processes) {
			if (!roles.has(proc.processName)) {
				roles.set(proc.processName, proc.processRole);
			}
		}
	}

	return new Map([...roles].map(([name, role]) => [
		name,
		{ bytes: median(perLaunch.map(totals => totals.get(name) ?? 0)), role }
	]));
}

/**
 * Eager activations across launches, keyed by id.
 *
 * A union rather than launch 0, and an extension counts as eager if any launch
 * saw it activate eagerly. An extension that is eager only sometimes is still
 * eager, and reading one launch would miss it whenever it lost the race.
 */
function eagerExtensions(snapshots: MemorySnapshot[]): ActivatedExtension[] {
	const eager = new Map<string, ActivatedExtension>();
	for (const snapshot of snapshots) {
		for (const extension of snapshot.extensions) {
			if (isEagerActivation(extension.activationEvent) && !eager.has(extension.extensionId)) {
				eager.set(extension.extensionId, extension);
			}
		}
	}
	return [...eager.values()];
}

/** Every process seen in any launch, keyed by name, so an intermittent one is not missed. */
function processesAcrossLaunches(snapshots: MemorySnapshot[]): LabeledProcess[] {
	const seen = new Map<string, LabeledProcess>();
	for (const snapshot of snapshots) {
		for (const proc of snapshot.processes) {
			if (!seen.has(proc.processName)) {
				seen.set(proc.processName, proc);
			}
		}
	}
	return [...seen.values()];
}

/**
 * Processes present now that were absent from the baseline, keyed by name.
 *
 * Taken from the union across launches, not launch 0. A process that starts only
 * sometimes is exactly the kind of regression this section exists to surface, and
 * reading one launch would hide it whenever it missed that launch.
 */
function newProcesses(snapshots: MemorySnapshot[], baseline?: MemorySnapshot): LabeledProcess[] {
	if (!baseline) {
		return [];
	}
	const known = new Set(baseline.processes.map(p => p.processName));
	return processesAcrossLaunches(snapshots).filter(proc => !known.has(proc.processName));
}

/**
 * How the numbers below were arrived at. The discarded count is the load-bearing
 * part: every launch opens on a startup plateau that looks settled but sits
 * hundreds of MB high, and a reader has to see it was excluded.
 */
function samplingSummary(snapshots: MemorySnapshot[]): string {
	const settleS = Math.round(median(snapshots.map(s => s.settleMs)) / 1000);
	const sampled = snapshots.map(s => s.sampledMs).filter((ms): ms is number => ms !== undefined);
	const discarded = snapshots.map(s => s.discardedSamples).filter((ms): ms is number => ms !== undefined);
	const parts = [`Median of ${snapshots.length} launches`, `settled in ${settleS}s`];
	if (sampled.length > 0) {
		parts.push(`sampled for ${Math.round(median(sampled) / 1000)}s`);
	}
	if (discarded.length > 0) {
		parts.push(`discarding ${Math.round(median(discarded))} startup samples`);
	}
	return `${parts.join(', ')}.`;
}

/**
 * Retained bytes below which an extension collapses into a single "others" row.
 *
 * A fixed byte floor rather than a top N or a percentage: it keeps a newly
 * appearing extension visible the moment it matters, and the long tail is real
 * (14 extensions under 0.2 MB in a measured heap).
 */
export const EXTENSION_HEAP_FLOOR_BYTES = 1_048_576;

/** The unattributed remainder's row label, in both report formats. */
export const UNATTRIBUTED_ROW = 'unattributed';

/**
 * Magnitude of an extension-row figure. `formatBytes` alone rounds to one MB
 * decimal, which flattens a real sub-MB extension change to "0.0 MB" --
 * extensions sit an order of magnitude below the role table's figures, so
 * anything below 1 MB is shown in KB instead. Binary units throughout.
 */
function extensionMagnitude(bytes: number): string {
	const abs = Math.abs(bytes);
	if (abs >= 1024 * KB) {
		return formatBytes(abs);
	}
	return `${(abs / KB).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} KB`;
}

/** Signed delta for an extension row, in the markdown table. */
function signedExtensionChange(bytes: number): string {
	return `${bytes >= 0 ? '+' : '-'}${extensionMagnitude(bytes)}`;
}

/**
 * The extension-row counterpart of `deltaHtmlFromDiff`: same glyph, same
 * classes, one scale down. Flat is under a KB rather than under an MB, since
 * the shared MB band would swallow every extension delta there is and no row
 * would ever get an arrow.
 */
function extensionDeltaHtml(diff: number): string {
	const flat = Math.abs(diff) < KB;
	const cls = flat ? 'delta-flat' : diff > 0 ? 'delta-up' : 'delta-down';
	const glyph = flat ? '' : diff > 0 ? '&#9650; ' : '&#9660; ';
	return `<span class="${cls}">${glyph}${flat ? signedExtensionChange(diff) : extensionMagnitude(diff)}</span>`;
}

/** The change cell for one extension row, matching how the role table renders a delta and a new row. */
function extensionChangeHtml(row: ExtensionHeapRow): string {
	if (row.changeBytes !== undefined) {
		return extensionDeltaHtml(row.changeBytes);
	}
	return row.change === '' ? '' : `<span class="delta-flat">${escapeHtml(row.change)}</span>`;
}

/**
 * Median retained bytes per extension across launches, zero-filling a launch
 * that did not have one, for the same reason `byRole` does.
 */
function extensionHeapMedians(breakdowns: ExtensionHeapBreakdown[]): Map<string, number> {
	const ids = new Set(breakdowns.flatMap(b => b.extensions.map(e => e.extensionId)));
	return new Map([...ids].map(id => [
		id,
		median(breakdowns.map(b => b.extensions.find(e => e.extensionId === id)?.retainedBytes ?? 0))
	]));
}

/** Said in both formats when no launch produced a breakdown. */
const EXTENSION_HEAP_UNAVAILABLE = 'Per-extension breakdown unavailable for this run.';

/**
 * One sentence per wire status, so the reader learns why instead of reading an
 * absent table as "no extensions". `ok` is deliberately absent: it has no
 * failure to explain, so it falls back to the bare sentence like an
 * unrecognized status does.
 */
const EXTENSION_HEAP_REASONS: Partial<Record<ExtensionHeapStatus, string>> = {
	capture_failed: 'The extension host inspector did not produce a heap snapshot.',
	parse_failed: 'The heap snapshot was captured but could not be read back.',
	unsupported_format: 'The heap snapshot was not in the format this parser understands.',
	untrusted: 'Too many nodes had an unresolved script id, so the partition was discarded as incomplete.'
};

/**
 * The unavailable sentence plus the reason, for the run's first status: every
 * launch of a scenario runs the same build the same way, so they fail alike.
 * Runs predating the feature carry no status and get the bare sentence.
 */
export function extensionHeapUnavailableText(snapshots: MemorySnapshot[]): string {
	const status = snapshots.map(s => s.extensionHeapStatus).find(s => s !== undefined);
	const reason = status === undefined ? undefined : EXTENSION_HEAP_REASONS[status];
	return reason ? `${EXTENSION_HEAP_UNAVAILABLE} ${reason}` : EXTENSION_HEAP_UNAVAILABLE;
}

/**
 * The per-extension rows, largest first, with everything under the floor
 * collapsed and `unattributed` always last.
 *
 * `unattributed` is always shown: it is most of the heap, and hiding it would
 * imply the extensions sum to the extension host row.
 */
export type ExtensionHeapRow = {
	extensionId: string;
	bytes: number;
	/** The rendered change for the markdown table: blank, "new", or a signed figure. */
	change: string;
	/** The same change unrendered, so the HTML card can put a glyph and a class on it. Undefined when there is nothing to compare against. */
	changeBytes?: number;
};

export function extensionHeapRows(
	snapshots: MemorySnapshot[],
	baseline?: MemorySnapshot
): ExtensionHeapRow[] {
	const breakdowns = snapshots.map(s => s.extensionHeap).filter((b): b is ExtensionHeapBreakdown => b !== undefined);
	if (breakdowns.length === 0) {
		return [];
	}
	const medians = extensionHeapMedians(breakdowns);
	const baselineBreakdown = baseline?.extensionHeap;
	const baselineBytes = new Map(baselineBreakdown?.extensions.map(e => [e.extensionId, e.retainedBytes]) ?? []);

	// Blank rather than "new" everywhere when there is no extension-level
	// baseline at all, which is the first night and any run against a baseline
	// captured before this shipped.
	const changeFor = (id: string, bytes: number): Pick<ExtensionHeapRow, 'change' | 'changeBytes'> => {
		if (!baselineBreakdown) {
			return { change: '' };
		}
		const before = baselineBytes.get(id);
		if (before === undefined) {
			return { change: 'new' };
		}
		return { change: signedExtensionChange(bytes - before), changeBytes: bytes - before };
	};

	const ranked = [...medians].sort((a, b) => b[1] - a[1]);
	const shown = ranked.filter(([, bytes]) => bytes >= EXTENSION_HEAP_FLOOR_BYTES);
	const collapsed = ranked.filter(([, bytes]) => bytes > 0 && bytes < EXTENSION_HEAP_FLOOR_BYTES);

	const rows: ExtensionHeapRow[] = shown.map(([extensionId, bytes]) => ({ extensionId, bytes, ...changeFor(extensionId, bytes) }));
	if (collapsed.length > 0) {
		rows.push({
			extensionId: `(${collapsed.length} others)`,
			bytes: collapsed.reduce((sum, [, bytes]) => sum + bytes, 0),
			change: ''
		});
	}
	const unattributed = median(breakdowns.map(b => b.unattributedBytes));
	const unattributedDiff = baselineBreakdown ? unattributed - baselineBreakdown.unattributedBytes : undefined;
	rows.push({
		extensionId: UNATTRIBUTED_ROW,
		bytes: unattributed,
		change: unattributedDiff === undefined ? '' : signedExtensionChange(unattributedDiff),
		changeBytes: unattributedDiff
	});
	return rows;
}

export function renderMarkdown(snapshots: MemorySnapshot[], baseline?: MemorySnapshot): string {
	const total = totalAcrossLaunches(snapshots);
	const lines: string[] = [`## Memory: ${snapshots[0]?.scenario}`, ''];

	lines.push(baseline
		? `**Total: ${formatBytes(total)}** (${signed(total - baseline.treeTotalPssBytes)} vs previous nightly)`
		: `**Total: ${formatBytes(total)}**`);
	// The workflow measures latest-prerelease, so the build changes run to run and the
	// numbers mean little without it. Omitted when absent rather than rendered empty.
	if (snapshots[0]?.positronVersion) {
		lines.push(`**Build: ${snapshots[0].positronVersion}**`);
	}
	lines.push('');
	lines.push(samplingSummary(snapshots));
	lines.push('');

	// Ahead of the table for the same reason the HTML card sits above every
	// figure: it says the numbers below are medians of a moving process.
	const moving = snapshots.flatMap(s => unstableProcesses(s.processes).map(p => ({ launchIndex: s.launchIndex, p })));
	if (moving.length > 0) {
		lines.push('**Not a steady state.** These processes were still moving while being sampled, so the figures below are medians of a range:');
		for (const { launchIndex, p } of moving) {
			lines.push(`- launch ${launchIndex} \`${p.processName}\` (${p.processRole}): ${formatBytes(p.pssMin)} - ${formatBytes(p.pssMax)}, reported ${formatBytes(p.pssBytes)}`);
		}
		lines.push('');
	}

	// Kept small on purpose: this table is the whole step summary now. Per-process
	// detail and the full extension list moved to the HTML artifact, which is the
	// point of this change -- the giant per-process table was unreadable here.
	const roleTotals = byRole(snapshots);
	const baselineRoles = baseline ? byRole([baseline]) : new Map<ProcessRole, number>();
	lines.push('| Role | PSS | Change |', '| --- | --- | --- |');
	for (const [role, bytes] of [...roleTotals].sort((a, b) => b[1] - a[1])) {
		const before = baselineRoles.get(role);
		const change = baseline ? (before === undefined ? 'new' : signed(bytes - before)) : '';
		lines.push(`| \`${role}\` | ${formatBytes(bytes)} | ${change} |`);
	}
	lines.push('');

	const heapRows = extensionHeapRows(snapshots, baseline);
	if (heapRows.length === 0) {
		lines.push(`_${extensionHeapUnavailableText(snapshots)}_`, '');
	} else {
		lines.push(`### Extension host heap: ${snapshots[0]?.scenario}`, '');
		lines.push('| Extension | Retained | Change |', '| --- | --- | --- |');
		for (const row of heapRows) {
			const label = row.extensionId === UNATTRIBUTED_ROW ? `_${UNATTRIBUTED_ROW}_` : `\`${row.extensionId}\``;
			lines.push(`| ${label} | ${formatBytes(row.bytes)} | ${row.change} |`);
		}
		lines.push('');
	}

	return lines.join('\n');
}

/**
 * Truncates a process name for display in the tree's name column.
 *
 * Some process names are a full command line (the supervisor wrapper script
 * invocation is 465 characters), and `.tree-name`'s `nowrap` pushes every
 * numeric column off the card for a name that long. The full name still
 * belongs somewhere -- callers put it in a `title` attribute -- but the cell
 * itself needs a length a table row can actually hold.
 */
function shortName(name: string): string {
	return name.length > 60 ? `${name.slice(0, 60)}...` : name;
}

/** Largest single process PSS in the first launch, for scaling the magnitude bars. */
function maxProcessPss(snapshot: MemorySnapshot): number {
	return snapshot.processes.reduce((max, p) => Math.max(max, p.pssBytes), 0);
}

/** Inline horizontal bar sized proportionally to `bytes` relative to `maxBytes`. */
function magnitudeBar(bytes: number, maxBytes: number): string {
	const pct = maxBytes > 0 ? Math.min(100, Math.max(0, (bytes / maxBytes) * 100)) : 0;
	return `<div class="bar-track"><div class="bar-fill" style="width:${pct.toFixed(1)}%"></div></div>`;
}

/**
 * Orders processes into an actual depth-first traversal, parent immediately
 * followed by its own children, instead of trusting the snapshot's array
 * order.
 *
 * The snapshot's array order does not reliably keep a child adjacent to its
 * parent -- e.g. a renderer window can land after an unrelated process that
 * happens to share its depth -- so this rebuilds the tree from `ppid` and
 * walks it explicitly. Within one parent's children, the biggest PSS
 * consumer goes first, since that is the child most worth reading about.
 *
 * Two edge cases matter and are handled explicitly rather than left to
 * whatever the recursion happens to do:
 * - A process whose `ppid` is not present in the snapshot (the parent was
 *   not captured, or already exited) is an orphan. It is appended at the end
 *   rather than silently dropped, so no process disappears from the report.
 * - A cycle in the data (should not happen, but this is process data read
 *   from procfs under load) cannot cause infinite recursion: each pid is
 *   visited at most once, tracked via `visited`.
 */
function orderDepthFirst(processes: LabeledProcess[]): LabeledProcess[] {
	const byPid = new Map(processes.map(p => [p.pid, p]));
	const childrenByPpid = new Map<number, LabeledProcess[]>();
	for (const proc of processes) {
		if (proc.ppid === proc.pid || !byPid.has(proc.ppid)) {
			continue;
		}
		const siblings = childrenByPpid.get(proc.ppid) ?? [];
		siblings.push(proc);
		childrenByPpid.set(proc.ppid, siblings);
	}
	for (const siblings of childrenByPpid.values()) {
		siblings.sort((a, b) => b.pssBytes - a.pssBytes);
	}

	const visited = new Set<number>();
	const ordered: LabeledProcess[] = [];
	const visit = (proc: LabeledProcess) => {
		if (visited.has(proc.pid)) {
			return;
		}
		visited.add(proc.pid);
		ordered.push(proc);
		for (const child of childrenByPpid.get(proc.pid) ?? []) {
			visit(child);
		}
	};

	const root = processes.find(p => p.depth === 0);
	if (root) {
		visit(root);
	}
	// Anything not reached from the root -- an orphan whose parent is absent
	// from the snapshot, or a process behind a cycle -- still needs to appear.
	for (const proc of processes) {
		visit(proc);
	}
	return ordered;
}

/**
 * Renders the process tree ordered by {@link orderDepthFirst} so a child
 * renders immediately under the parent that spawned it.
 *
 * Each row also carries a delta against `baselineNames`, matched by process
 * name since pids do not survive across launches. This is what tells the
 * reader which of several processes sharing a role actually grew -- a role-level
 * delta on `language_server` cannot say whether the Quarto LSP or the JSON one
 * moved, and that is exactly the distinction this column exists to draw.
 */
function processTreeRows(snapshot: MemorySnapshot, maxBytes: number, baseline: MemorySnapshot | undefined, baselineNames: Map<string, { bytes: number; role: ProcessRole }>): string {
	return orderDepthFirst(snapshot.processes).map(proc => {
		let change = '';
		if (baseline) {
			const before = baselineNames.get(proc.processName);
			change = before === undefined ? '<span class="delta-flat">new</span>' : deltaHtml(proc.pssBytes, before.bytes);
		}
		const fullName = escapeHtml(proc.processName);
		const displayName = escapeHtml(shortName(proc.processName));
		return `<tr>
			<td class="tree-name" style="padding-left:${8 + proc.depth * 20}px" title="${fullName}"><code>${displayName}</code></td>
			<td><code>${escapeHtml(proc.processRole)}</code></td>
			<td class="num-cell" align="right">${formatBytes(proc.pssBytes)}</td>
			<td>${magnitudeBar(proc.pssBytes, maxBytes)}</td>
			<td class="num-cell" align="right">${formatBytes(proc.rssBytes)}</td>
			<td class="num-cell" align="right">${proc.pid}</td>
			<td class="num-cell" align="right">${change}</td>
		</tr>`;
	}).join('\n');
}

/**
 * Warns when any launch sampled a process that was still moving, naming it and
 * showing the range its samples spanned.
 *
 * Placed above every figure in the report because it invalidates them: the
 * headline total, that process's row, and its delta are all medians of a moving
 * number. Returns '' when everything settled, so a healthy report gains nothing.
 */
function instabilityHtml(snapshots: MemorySnapshot[]): string {
	const moving = snapshots.flatMap(snapshot =>
		unstableProcesses(snapshot.processes).map(proc => ({ launchIndex: snapshot.launchIndex, proc })));
	if (moving.length === 0) {
		return '';
	}

	const rows = moving.map(({ launchIndex, proc }) => `<tr>
		<td class="num-cell" align="right">${launchIndex}</td>
		<td>${escapeHtml(shortName(proc.processName))}</td>
		<td><code>${escapeHtml(proc.processRole)}</code></td>
		<td class="num-cell" align="right">${formatBytes(proc.pssMin)} &ndash; ${formatBytes(proc.pssMax)}</td>
		<td class="num-cell" align="right">${formatBytes(proc.pssMax - proc.pssMin)}</td>
		<td class="num-cell" align="right">${formatBytes(proc.pssBytes)}</td>
	</tr>`).join('\n');

	return notSteadyStateCardHtml(['#Launch', 'Process', 'Role', '#Range', '#Spread', '#Reported'], rows);
}

/**
 * Extension ids grouped by activation event for the single "Activated
 * extensions" card.
 *
 * The eager groups (`*`, then `onStartupFinished`) always sort first and
 * carry a badge, because they are the groups the "N of M activate eagerly"
 * headline and the "Newly eager" callout are both talking about; a reader
 * scanning the card needs to be able to find them without reading every
 * heading. The remaining groups keep the old biggest-group-first order.
 *
 * This used to be two cards -- "Eagerly activated extensions" duplicated the
 * `*`/`onStartupFinished` groups that already appeared in "Activated
 * extensions (N)" below it. One card, one place to look.
 */
function groupedExtensionsHtml(snapshot: MemorySnapshot): string {
	const groups = new Map<string, ActivatedExtension[]>();
	for (const extension of snapshot.extensions) {
		const key = extension.activationEvent ?? '(unknown)';
		const group = groups.get(key) ?? [];
		group.push(extension);
		groups.set(key, group);
	}

	const eagerRank = new Map(EAGER_EVENTS.map(({ event }, index) => [event, index]));
	const ordered = [...groups.entries()].sort((a, b) => {
		const rankA = eagerRank.get(a[0]);
		const rankB = eagerRank.get(b[0]);
		if (rankA !== undefined && rankB !== undefined) {
			return rankA - rankB;
		}
		if (rankA !== undefined) {
			return -1;
		}
		if (rankB !== undefined) {
			return 1;
		}
		return b[1].length - a[1].length;
	});

	const eagerGroups = ordered.filter(([event]) => eagerRank.has(event));
	const demandCount = ordered
		.filter(([event]) => !eagerRank.has(event))
		.reduce((sum, [, extensions]) => sum + extensions.length, 0);

	const sections = eagerGroups.map(([event, extensions]) => {
		const sorted = [...extensions].sort((a, b) => a.extensionId.localeCompare(b.extensionId));
		const items = sorted.slice(0, MAX_PER_GROUP)
			.map(ext => `<li><code>${escapeHtml(ext.extensionId)}</code>${ext.activationTimeMs === null ? '' : ` (${ext.activationTimeMs} ms)`}</li>`)
			.join('\n');
		const more = sorted.length > MAX_PER_GROUP
			? `<li class="muted">...${sorted.length - MAX_PER_GROUP} more</li>`
			: '';
		// No badge: it marked every group once the demand-activated ones stopped being
		// listed beside them. The headline says what eager costs, the headings say when.
		// The literal goes in a tooltip: shown inline it needed a gloss to stop reading
		// as a footnote marker, which shaped this heading unlike the other one.
		const { title } = EAGER_EVENTS.find(e => e.event === event)!;
		const heading = title
			? `<span title="activationEvents: ${escapeHtml(event)}">${escapeHtml(title)}</span> (${sorted.length})`
			: `<code>${escapeHtml(event)}</code> (${sorted.length})`;
		return `<h3>${heading}</h3>
		<ul>
${items}
${more}
		</ul>`;
	});

	// Collapsed rather than listed. Demand-activated groups were 25 of 27 headings
	// and over half the page, sitting below the tables this report exists for, and
	// nothing acts on them: an extension that activates only when you open a .qmd
	// costs nothing until you do. The eager groups above are the ones the headline
	// count and the "Newly eager" callout are both about.
	if (demandCount > 0) {
		const noun = demandCount === 1 ? 'extension' : 'extensions';
		sections.push(`<p class="muted">${demandCount} further ${noun} activated on demand.</p>`);
	}

	return sections.join('\n');
}

/**
 * "N of M activate eagerly" headline for the merged extensions card, drawn
 * from the same `first` snapshot the card's groups are built from so the
 * headline count can never disagree with what the groups below it show.
 *
 * States the cost once, here, rather than per group. What "eager" means is one
 * fact about the whole section, and repeating it on each heading is what made the
 * badge look like an unfinished sentence on the group that lacked a note.
 */
function eagerHeadlineHtml(snapshot: MemorySnapshot): string {
	const eagerCount = snapshot.extensions.filter(e => isEagerActivation(e.activationEvent)).length;
	return `<p><strong>${eagerCount} of ${snapshot.extensions.length}</strong> activate eagerly: they
	cost memory in every window, whether or not the feature is used.</p>`;
}

/**
 * "Newly eager" callout: an extension that activated eagerly this run but did
 * not in the baseline. This is a diff, not a listing -- unlike the merged
 * card above it, it is the actual regression signal, so it stays separate.
 *
 * Keeps the old markdown's rule: an extension counts as eager if any launch
 * saw it activate eagerly, and a newly-eager extension (present before but
 * activating on demand) is called out even if it was not new to the window.
 */
function newlyEagerHtml(snapshots: MemorySnapshot[], baseline?: MemorySnapshot): string {
	const eager = eagerExtensions(snapshots);

	// A baseline whose rows all carry a null event cannot say how anything
	// activated, so every extension would read as newly eager. Suppress the
	// callout rather than publish a fake alarm.
	const baselineKnowsEvents = baseline?.extensions.some(e => e.activationEvent !== null) ?? false;
	if (!baselineKnowsEvents) {
		return '';
	}
	const baselineEager = eagerExtensions([baseline!]);
	const before = new Set(baselineEager.map(e => e.extensionId));
	const newlyEager = eager.filter(e => !before.has(e.extensionId));
	if (newlyEager.length === 0) {
		return '';
	}

	const items = newlyEager
		.map(e => `<li><code>${escapeHtml(e.extensionId)}</code> (<code>${escapeHtml(e.activationEvent ?? '')}</code>)</li>`)
		.join('\n');
	return `<div class="card">
		<h2>Newly eager (${newlyEager.length})</h2>
		<ul>
${items}
		</ul>
	</div>`;
}

/**
 * "New since the previous nightly" card. This is how a newly-spawned child
 * server announces itself -- the process that prompted this whole report
 * would show up exactly this way. Shown only when there is a baseline to
 * compare against and something to report.
 */
function newProcessesHtml(snapshots: MemorySnapshot[], baseline?: MemorySnapshot): string {
	const appeared = newProcesses(snapshots, baseline);
	if (!baseline || appeared.length === 0) {
		return '';
	}
	const rows = appeared.map(proc => `<tr>
			<td class="tree-name" title="${escapeHtml(proc.processName)}"><code>${escapeHtml(shortName(proc.processName))}</code></td>
			<td><code>${escapeHtml(proc.processRole)}</code></td>
			<td class="num-cell" align="right">${formatBytes(proc.pssBytes)}</td>
		</tr>`).join('\n');
	return `<div class="card">
		<h2>New since the previous nightly (${appeared.length})</h2>
		<table>
			<tr><th>Process</th><th>Role</th><th class="num-cell" align="right">PSS</th></tr>
			${rows}
		</table>
	</div>`;
}

/**
 * Note on memory the collector could not attribute to a role, so a new
 * unattributed process cannot hide inside a plausible-looking total.
 *
 * Reports the same unlabeled total the role table above implies (`roleTotals`
 * is passed in rather than recomputed) so the two figures cannot disagree.
 */
function unlabeledNoteHtml(snapshots: MemorySnapshot[], roleTotals: Map<ProcessRole, number>): string {
	const unlabeled = processesAcrossLaunches(snapshots).filter(p => p.processRole === 'unlabeled');
	if (unlabeled.length === 0) {
		return '';
	}
	const bytes = roleTotals.get('unlabeled') ?? 0;
	// Truncated the same way as the tree: an unlabeled process is just as
	// likely to be a full command line, and a wall of path text would dominate
	// this note the same way it dominated the tree and the new-since card.
	const names = unlabeled.map(p => `<code title="${escapeHtml(p.processName)}">${escapeHtml(shortName(p.processName))}</code>`).join(', ');
	return `<p class="muted">${unlabeled.length} unlabeled process name(s) across ${snapshots.length} launch(es), ${formatBytes(bytes)} in the median launch: ${names}. Add them to the role map in <code>test/e2e/utils/memory/label.ts</code>.</p>`;
}

export function renderHtml(snapshots: MemorySnapshot[], baseline?: MemorySnapshot): string {
	const first = snapshots[0];
	const total = totalAcrossLaunches(snapshots);
	const maxBytes = maxProcessPss(first);

	const roleTotals = byRole(snapshots);
	const baselineRoles = baseline ? byRole([baseline]) : new Map<ProcessRole, number>();
	const roleRows = [...roleTotals]
		.sort((a, b) => b[1] - a[1])
		.map(([role, bytes]) => `<tr>
			<td><code>${escapeHtml(role)}</code></td>
			<td align="right">${formatBytes(bytes)}</td>
			<td>${magnitudeBar(bytes, Math.max(...roleTotals.values()))}</td>
			<td align="right">${baseline ? (baselineRoles.has(role) ? deltaHtml(bytes, baselineRoles.get(role)!) : '<span class="delta-flat">new</span>') : ''}</td>
		</tr>`).join('\n');

	const baselineNames = baseline ? byProcessName([baseline]) : new Map<string, { bytes: number; role: ProcessRole }>();
	const treeRows = processTreeRows(first, maxBytes, baseline, baselineNames);
	const extensionsByEvent = groupedExtensionsHtml(first);
	const eagerHeadline = eagerHeadlineHtml(first);
	const newlyEagerCard = newlyEagerHtml(snapshots, baseline);
	const newProcessesCard = newProcessesHtml(snapshots, baseline);
	const unlabeledNote = unlabeledNoteHtml(snapshots, roleTotals);
	const instabilityCard = instabilityHtml(snapshots);

	const heapRows = extensionHeapRows(snapshots, baseline);
	const maxHeapBytes = Math.max(0, ...heapRows.map(row => row.bytes));
	const extensionHeapCard = heapRows.length === 0
		? `<div class="card">
		<h2>Extension host heap</h2>
		<p class="muted">${escapeHtml(extensionHeapUnavailableText(snapshots))}</p>
	</div>`
		: `<div class="card">
		<h2>Extension host heap</h2>
		<table>
			<tr><th>Extension</th><th align="right">Retained</th><th></th><th align="right">Change</th></tr>
			${heapRows.map(row => `<tr>
				<td>${row.extensionId === UNATTRIBUTED_ROW ? `<em>${UNATTRIBUTED_ROW}</em>` : `<code>${escapeHtml(row.extensionId)}</code>`}</td>
				<td align="right">${formatBytes(row.bytes)}</td>
				<td>${magnitudeBar(row.bytes, maxHeapBytes)}</td>
				<td align="right">${extensionChangeHtml(row)}</td>
			</tr>`).join('\n')}
		</table>
		<p class="muted">A dominator-tree partition of the reachable extension host heap: every byte is credited to the nearest owning extension, so the rows sum to the total and nothing is counted twice. <em>unattributed</em> is the extension host runtime and node internals.</p>
	</div>`;

	return `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<title>Positron memory: ${escapeHtml(first.lane)} ${escapeHtml(first.scenario)}</title>
	<style>${REPORT_CSS}
	</style>
</head>
<body>
<div class="container">
	<div class="header">
		<h1>${escapeHtml(first.lane)} ${escapeHtml(first.scenario)}</h1>
		<div class="meta">${first.positronVersion ? `Build: ${escapeHtml(first.positronVersion)}` : ''}</div>
		<div class="hero">${formatBytes(total)}</div>
		${baseline ? `<div class="meta">${deltaHtml(total, baseline.treeTotalPssBytes)} vs previous nightly</div>` : ''}
		<div class="meta">${escapeHtml(samplingSummary(snapshots))}</div>
		${snapshots.some(s => (s.forcedGc?.length ?? 0) > 0) ? `<div class="meta">${GC_NOTE}</div>` : ''}
	</div>

	${instabilityCard}

	<div class="card">
		<h2>Memory by role</h2>
		<table>
			<tr><th>Role</th><th align="right">PSS</th><th></th><th align="right">Change</th></tr>
			${roleRows}
		</table>
		${unlabeledNote}
	</div>

	${extensionHeapCard}

	<div class="card">
		<h2>Process tree</h2>
		<table class="tree-table">
			<colgroup><col><col style="width:150px"><col style="width:90px"><col style="width:100px"><col style="width:90px"><col style="width:60px"><col style="width:110px"></colgroup>
			<tr><th>Process</th><th>Role</th><th class="num-cell" align="right">PSS</th><th></th><th class="num-cell" align="right">RSS</th><th class="num-cell" align="right">PID</th><th class="num-cell" align="right">Change</th></tr>
			${treeRows}
		</table>
	</div>

	${newProcessesCard}

	${newlyEagerCard}

	<div class="card">
		<h2>Activated extensions (${first.extensions.length})</h2>
		${eagerHeadline}
		${extensionsByEvent}
	</div>
</div>
</body>
</html>`;
}
