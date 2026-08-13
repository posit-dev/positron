/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { deltaHtml, escapeHtml, formatBytes, notSteadyStateCardHtml, REPORT_CSS, signed } from './report-shell.js';
import { unstableProcesses } from './snapshot.js';
import { ActivatedExtension, LabeledProcess, MemorySnapshot, ProcessRole } from './types.js';

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
const EAGER_EVENTS: { event: string; note?: string }[] = [
	// Worst first. `*` does not wait for startup to finish, so it delays the
	// window itself rather than merely costing memory once it is up.
	{ event: '*', note: 'activates before startup finishes' },
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
 * How the numbers below were arrived at, in one line: launches, how long the tree
 * took to stop growing, and how much of the sampling window was thrown away.
 *
 * The discarded count is the load-bearing part. Every launch spends its first
 * 10-25s on a startup plateau that is flat enough to look settled but sits
 * hundreds of MB above the steady state, and a reader comparing two runs needs to
 * see that the plateau was excluded rather than assume it.
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
		parts.push(`discarding ${median(discarded)} startup samples`);
	}
	return `${parts.join(', ')}.`;
}

export function renderMarkdown(snapshots: MemorySnapshot[], baseline?: MemorySnapshot): string {
	const total = totalAcrossLaunches(snapshots);
	const lines: string[] = [`## Memory: ${snapshots[0].scenario}`, ''];

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
			<td class="tree-name" style="padding-left:${8 + proc.depth * 20}px" title="${fullName}">${displayName}</td>
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

	return ordered.map(([event, extensions]) => {
		const sorted = [...extensions].sort((a, b) => a.extensionId.localeCompare(b.extensionId));
		const items = sorted.slice(0, MAX_PER_GROUP)
			.map(ext => `<li><code>${escapeHtml(ext.extensionId)}</code>${ext.activationTimeMs === null ? '' : ` (${ext.activationTimeMs} ms)`}</li>`)
			.join('\n');
		const more = sorted.length > MAX_PER_GROUP
			? `<li class="muted">...${sorted.length - MAX_PER_GROUP} more</li>`
			: '';
		const eager = EAGER_EVENTS.find(e => e.event === event);
		const badge = eager
			? ` <span class="muted" title="activates eagerly">&#9889; eager${eager.note ? ` -- ${escapeHtml(eager.note)}` : ''}</span>`
			: '';
		return `<h3><code>${escapeHtml(event)}</code> (${sorted.length})${badge}</h3>
		<ul>
${items}
${more}
		</ul>`;
	}).join('\n');
}

/**
 * "N of M activate eagerly" headline for the merged extensions card, drawn
 * from the same `first` snapshot the card's groups are built from so the
 * headline count can never disagree with what the groups below it show.
 */
function eagerHeadlineHtml(snapshot: MemorySnapshot): string {
	const eagerCount = snapshot.extensions.filter(e => isEagerActivation(e.activationEvent)).length;
	return `<p><strong>${eagerCount} of ${snapshot.extensions.length}</strong> activate eagerly.</p>`;
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
			<td class="tree-name" title="${escapeHtml(proc.processName)}">${escapeHtml(shortName(proc.processName))}</td>
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

	return `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<title>Positron memory: ${escapeHtml(first.scenario)}</title>
	<style>${REPORT_CSS}
	</style>
</head>
<body>
<div class="container">
	<div class="header">
		<h1>${escapeHtml(first.scenario)}</h1>
		<div class="meta">${first.positronVersion ? `Build: ${escapeHtml(first.positronVersion)}` : ''}</div>
		<div class="hero">${formatBytes(total)}</div>
		<div class="meta">${baseline ? deltaHtml(total, baseline.treeTotalPssBytes) : 'no baseline'} vs previous nightly</div>
		<div class="meta">${escapeHtml(samplingSummary(snapshots))}</div>
	</div>

	${instabilityCard}

	<div class="card">
		<h2>By role</h2>
		<table>
			<tr><th>Role</th><th align="right">PSS</th><th></th><th align="right">Change</th></tr>
			${roleRows}
		</table>
		${unlabeledNote}
	</div>

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
