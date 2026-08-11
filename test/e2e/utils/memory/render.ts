/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ActivatedExtension, LabeledProcess, MemorySnapshot, ProcessRole } from './types.js';

/** How many processes the top-processes table lists. */
const TOP_PROCESSES = 8;

/**
 * Roles that are Positron's fixed process architecture: exactly one process
 * each, always present, and named predictably by their role.
 *
 * Excluded from the top-processes table because their rows repeat the role table
 * byte for byte. `main` is `positron`, `gpu` is `gpu-process`, `extension_host`
 * is `extension-host [1]`. Nine of fourteen roles are singletons like this, so
 * listing them spent six of eight rows restating the table directly above and
 * pushed the informative rows off the bottom.
 *
 * What is left is everything spawned by or for an extension, which is what the
 * table exists to name. Nothing is lost: a regression in the renderer or the
 * extension host shows in the role table at the same number.
 */
const SKELETON_ROLES = new Set<ProcessRole>([
	'main', 'renderer', 'gpu', 'network', 'shared',
	'extension_host', 'pty_host', 'file_watcher', 'agent_host'
]);

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

const MB = 1024 * 1024;

export function formatBytes(bytes: number): string {
	const mb = bytes / MB;
	return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`;
}

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function signed(bytes: number): string {
	const sign = bytes >= 0 ? '+' : '-';
	return `${sign}${formatBytes(Math.abs(bytes))}`;
}

function signedCount(count: number): string {
	return count >= 0 ? `+${count}` : `${count}`;
}

/**
 * A process nothing could name is reported by its whole command line, which can
 * run to hundreds of characters. Enough to identify one is enough to print.
 */
function shortName(name: string): string {
	return name.length > 60 ? `${name.slice(0, 60)}...` : name;
}

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
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
function byRole(snapshots: MemorySnapshot[]): Map<ProcessRole, number> {
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

export function renderMarkdown(snapshots: MemorySnapshot[], baseline?: MemorySnapshot): string {
	const total = totalAcrossLaunches(snapshots);
	const lines: string[] = ['## Memory: idle', ''];

	lines.push(baseline
		? `**Total: ${formatBytes(total)}** (${signed(total - baseline.treeTotalPssBytes)} vs previous nightly)`
		: `**Total: ${formatBytes(total)}**`);
	// The workflow measures latest-prerelease, so the build changes run to run and a
	// number is not interpretable without it. Omitted rather than shown empty when
	// absent, so a report that cannot name its build does not look like one that can.
	if (snapshots[0]?.positronVersion) {
		lines.push(`**Build: ${snapshots[0].positronVersion}**`);
	}
	lines.push('');
	lines.push(`Median of ${snapshots.length} launches. Settle time: ${Math.round(median(snapshots.map(s => s.settleMs)) / 1000)}s.`);
	lines.push('');

	const roleTotals = byRole(snapshots);
	const baselineRoles = baseline ? byRole([baseline]) : new Map<ProcessRole, number>();
	lines.push('| Role | PSS | Change |', '| --- | --- | --- |');
	for (const [role, bytes] of [...roleTotals].sort((a, b) => b[1] - a[1])) {
		const before = baselineRoles.get(role);
		const change = baseline ? (before === undefined ? 'new' : signed(bytes - before)) : '';
		lines.push(`| \`${role}\` | ${formatBytes(bytes)} | ${change} |`);
	}
	lines.push('');

	// Names the culprit behind a role. `language_server` growing says nothing on
	// its own; `quarto.quarto (lsp)` growing is a place to go and look.
	const named = byProcessName(snapshots);
	const baselineNames = baseline ? byProcessName([baseline]) : new Map<string, { bytes: number; role: ProcessRole }>();
	const top = [...named]
		.filter(([, { role }]) => !SKELETON_ROLES.has(role))
		.sort((a, b) => b[1].bytes - a[1].bytes)
		.slice(0, TOP_PROCESSES);
	if (top.length > 0) {
		lines.push('### Top processes', '');
		lines.push('Excludes the one-per-role processes (renderer, extension host, main, gpu, network, shared, pty host, file watcher, agent host); the role table above reports those at the same figures.', '');
		lines.push('| Process | Role | PSS | Change |', '| --- | --- | --- | --- |');
		for (const [name, { bytes, role }] of top) {
			const before = baselineNames.get(name)?.bytes;
			const change = baseline ? (before === undefined ? 'new' : signed(bytes - before)) : '';
			lines.push(`| \`${shortName(name)}\` | \`${role}\` | ${formatBytes(bytes)} | ${change} |`);
		}
		lines.push('');
	}

	// The only handle on memory held inside the extension host, which is one
	// process and so cannot be split by any amount of process detail.
	const eager = eagerExtensions(snapshots);
	if (eager.length > 0) {
		// A baseline whose rows all carry a null event cannot say how anything
		// activated, so every extension would read as newly eager. Suppress both
		// the delta and the list rather than publish a fake alarm.
		const baselineKnowsEvents = baseline?.extensions.some(e => e.activationEvent !== null) ?? false;
		const baselineEager = baselineKnowsEvents ? eagerExtensions([baseline!]) : [];
		const delta = baselineKnowsEvents ? ` (${signedCount(eager.length - baselineEager.length)} vs previous nightly)` : '';

		lines.push('### Extensions activating at startup', '');
		lines.push(`**${eager.length} eager**${delta}`, '');

		if (baselineKnowsEvents) {
			const before = new Set(baselineEager.map(e => e.extensionId));
			const newlyEager = eager.filter(e => !before.has(e.extensionId));
			if (newlyEager.length > 0) {
				lines.push('Newly eager:', '');
				for (const extension of newlyEager) {
					lines.push(`- \`${extension.extensionId}\` (\`${extension.activationEvent}\`)`);
				}
				lines.push('');
			}
		}

		// Grouped rather than one comma-separated run. Fifteen ids on one line wrap
		// mid-name and are unreadable, and the run hid the distinction that matters
		// most: which of them use `*`.
		for (const { event, note } of EAGER_EVENTS) {
			const inGroup = eager
				.filter(e => e.activationEvent === event)
				.map(e => e.extensionId)
				.sort((a, b) => a.localeCompare(b));
			if (inGroup.length === 0) {
				continue;
			}
			lines.push(`\`${event}\` (${inGroup.length})${note ? ` -- ${note}` : ''}:`, '');
			for (const id of inGroup.slice(0, MAX_PER_GROUP)) {
				lines.push(`- \`${id}\``);
			}
			if (inGroup.length > MAX_PER_GROUP) {
				lines.push(`- ...${inGroup.length - MAX_PER_GROUP} more`);
			}
			lines.push('');
		}
	}

	const appeared = newProcesses(snapshots, baseline);
	if (appeared.length > 0) {
		lines.push('### New processes since the last nightly', '');
		for (const proc of appeared) {
			lines.push(`- \`${proc.processName}\` (${proc.processRole}) ${formatBytes(proc.pssBytes)}`);
		}
		lines.push('');
	}

	// Both figures span every launch, and the wording says which basis each uses.
	// The count is distinct names across all launches, so a process that starts
	// only sometimes still shows up; the bytes are the same median the table above
	// reports, so the two agree on the row the reader is looking at. Naming the
	// basis matters because the two cannot be made identical: several processes
	// share a name (Chromium runs two zygotes), and the count is per name.
	const unlabeled = processesAcrossLaunches(snapshots).filter(p => p.processRole === 'unlabeled');
	if (unlabeled.length > 0) {
		const bytes = roleTotals.get('unlabeled') ?? 0;
		// Unnamed children are reported by their whole command line, which can run
		// to hundreds of characters. Enough to identify one is enough here.
		const names = unlabeled
			.map(p => `\`${shortName(p.processName)}\``)
			.join(', ');
		lines.push(`> ${unlabeled.length} unlabeled process name(s) across ${snapshots.length} launch(es), ${formatBytes(bytes)} in the median launch: ${names}. Add them to the role map in \`test/e2e/utils/memory/label.ts\`.`, '');
	}

	return lines.join('\n');
}

export function renderHtml(snapshots: MemorySnapshot[], baseline?: MemorySnapshot): string {
	const rows = [...(snapshots[0]?.processes ?? [])]
		.sort((a, b) => b.pssBytes - a.pssBytes)
		.map(proc => `<tr>
			<td style="padding-left:${proc.depth * 20}px">${escapeHtml(proc.processName)}</td>
			<td><code>${escapeHtml(proc.processRole)}</code></td>
			<td align="right">${formatBytes(proc.pssBytes)}</td>
			<td align="right">${formatBytes(proc.rssBytes)}</td>
			<td align="right">${proc.pid}</td>
		</tr>`).join('\n');

	const extensions = (snapshots[0]?.extensions ?? [])
		.map(ext => `<li><code>${escapeHtml(ext.extensionId)}</code>${ext.activationTimeMs === null ? '' : ` (${ext.activationTimeMs} ms)`}</li>`)
		.join('\n');

	const total = totalAcrossLaunches(snapshots);

	return `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<title>Positron memory: idle</title>
	<style>
		body { font-family: system-ui, sans-serif; margin: 2rem; }
		table { border-collapse: collapse; width: 100%; }
		td, th { border-bottom: 1px solid #ddd; padding: 4px 8px; }
	</style>
</head>
<body>
	<h1>Positron memory: idle</h1>
	<p>Total PSS: <strong>${formatBytes(total)}</strong>${baseline ? ` (${signed(total - baseline.treeTotalPssBytes)} vs previous nightly)` : ''}</p>
	${snapshots[0]?.positronVersion ? `<p>Build: <strong>${escapeHtml(snapshots[0].positronVersion)}</strong></p>` : ''}
	<h2>Process tree</h2>
	<table>
		<tr><th align="left">Process</th><th align="left">Role</th><th align="right">PSS</th><th align="right">RSS</th><th align="right">PID</th></tr>
		${rows}
	</table>
	<h2>Activated extensions (${(snapshots[0]?.extensions ?? []).length})</h2>
	<ul>
${extensions}
	</ul>
</body>
</html>`;
}
