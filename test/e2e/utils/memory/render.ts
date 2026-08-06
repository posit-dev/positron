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

function byRole(snapshots: MemorySnapshot[]): Map<ProcessRole, number> {
	const totals = new Map<ProcessRole, number[]>();
	for (const snapshot of snapshots) {
		const perLaunch = new Map<ProcessRole, number>();
		for (const proc of snapshot.processes) {
			perLaunch.set(proc.processRole, (perLaunch.get(proc.processRole) ?? 0) + proc.pssBytes);
		}
		for (const [role, bytes] of perLaunch) {
			totals.set(role, [...(totals.get(role) ?? []), bytes]);
		}
	}
	return new Map([...totals].map(([role, values]) => [role, median(values)]));
}

/** Processes present now that were absent from the baseline, keyed by name. */
function newProcesses(snapshots: MemorySnapshot[], baseline?: MemorySnapshot): LabeledProcess[] {
	if (!baseline) {
		return [];
	}
	const known = new Set(baseline.processes.map(p => p.processName));
	const seen = new Map<string, LabeledProcess>();
	for (const proc of snapshots[0]?.processes ?? []) {
		if (!known.has(proc.processName)) {
			seen.set(proc.processName, proc);
		}
	}
	return [...seen.values()];
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

	const baselineRoles = baseline ? byRole([baseline]) : new Map<ProcessRole, number>();
	lines.push('| Role | PSS | Change |', '| --- | --- | --- |');
	for (const [role, bytes] of [...byRole(snapshots)].sort((a, b) => b[1] - a[1])) {
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

	const unlabeled = (snapshots[0]?.processes ?? []).filter(p => p.processRole === 'unlabeled');
	if (unlabeled.length > 0) {
		const bytes = unlabeled.reduce((sum, p) => sum + p.pssBytes, 0);
		lines.push(`> ${unlabeled.length} unlabeled process(es) totalling ${formatBytes(bytes)}. Add them to the role map in \`test/e2e/utils/memory/label.ts\`.`, '');
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
