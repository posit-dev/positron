/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { LabeledProcess, MemorySnapshot, ProcessRole } from './types.js';

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
			.map(p => p.processName.length > 60 ? `${p.processName.slice(0, 60)}...` : p.processName)
			.map(name => `\`${name}\``)
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
