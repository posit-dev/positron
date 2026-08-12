/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ActivatedExtension, MemorySnapshot, ProcessRole } from './types.js';

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
	lines.push(`Median of ${snapshots.length} launches. Settle time: ${Math.round(median(snapshots.map(s => s.settleMs)) / 1000)}s.`);
	lines.push('');

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

/** Largest single process PSS in the first launch, for scaling the magnitude bars. */
function maxProcessPss(snapshot: MemorySnapshot): number {
	return snapshot.processes.reduce((max, p) => Math.max(max, p.pssBytes), 0);
}

/** Inline horizontal bar sized proportionally to `bytes` relative to `maxBytes`. */
function magnitudeBar(bytes: number, maxBytes: number): string {
	const pct = maxBytes > 0 ? Math.min(100, Math.max(0, (bytes / maxBytes) * 100)) : 0;
	return `<div class="bar-track"><div class="bar-fill" style="width:${pct.toFixed(1)}%"></div></div>`;
}

/** Up/down triangle plus a signed number, so a delta is never conveyed by color alone. */
function deltaHtml(current: number, before: number): string {
	const diff = current - before;
	const cls = Math.abs(diff) < MB ? 'delta-flat' : diff > 0 ? 'delta-up' : 'delta-down';
	const glyph = Math.abs(diff) < MB ? '' : diff > 0 ? '&#9650; ' : '&#9660; ';
	return `<span class="${cls}">${glyph}${signed(diff)}</span>`;
}

/**
 * Renders the process tree in the array's own order rather than sorted by size.
 *
 * The snapshot lists a process after its parent, and carries the parent's depth
 * plus one, so the array order together with `depth` is what makes the
 * parent/child structure visible: sorting by PSS would scatter a child away from
 * the parent that spawned it, which is exactly the relationship this table
 * exists to show.
 */
function processTreeRows(snapshot: MemorySnapshot, maxBytes: number): string {
	return snapshot.processes.map(proc => `<tr>
			<td class="tree-name" style="padding-left:${8 + proc.depth * 20}px">${escapeHtml(proc.processName)}</td>
			<td><code>${escapeHtml(proc.processRole)}</code></td>
			<td align="right">${formatBytes(proc.pssBytes)}</td>
			<td>${magnitudeBar(proc.pssBytes, maxBytes)}</td>
			<td align="right">${formatBytes(proc.rssBytes)}</td>
			<td align="right">${proc.pid}</td>
		</tr>`).join('\n');
}

/** Extension ids grouped by activation event, most eventful group first, capped per group. */
function groupedExtensionsHtml(snapshot: MemorySnapshot): string {
	const groups = new Map<string, ActivatedExtension[]>();
	for (const extension of snapshot.extensions) {
		const key = extension.activationEvent ?? '(unknown)';
		const group = groups.get(key) ?? [];
		group.push(extension);
		groups.set(key, group);
	}

	const ordered = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);

	return ordered.map(([event, extensions]) => {
		const sorted = [...extensions].sort((a, b) => a.extensionId.localeCompare(b.extensionId));
		const items = sorted.slice(0, MAX_PER_GROUP)
			.map(ext => `<li><code>${escapeHtml(ext.extensionId)}</code>${ext.activationTimeMs === null ? '' : ` (${ext.activationTimeMs} ms)`}</li>`)
			.join('\n');
		const more = sorted.length > MAX_PER_GROUP
			? `<li class="muted">...${sorted.length - MAX_PER_GROUP} more</li>`
			: '';
		return `<h3><code>${escapeHtml(event)}</code> (${sorted.length})</h3>
		<ul>
${items}
${more}
		</ul>`;
	}).join('\n');
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

	const treeRows = processTreeRows(first, maxBytes);
	const extensionsByEvent = groupedExtensionsHtml(first);

	return `<!DOCTYPE html>
<html>
<head>
	<meta charset="utf-8">
	<title>Positron memory: ${escapeHtml(first.scenario)}</title>
	<style>
		body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 16px; background: #f9fafb; color: #374151; }
		.container { max-width: 960px; margin: 0 auto; }
		.header { background: #1f2937; color: white; padding: 16px 20px; border-radius: 8px; margin-bottom: 16px; }
		.header h1 { margin: 0 0 8px 0; font-size: 1.5rem; }
		.header .meta { opacity: 0.85; font-size: 0.9rem; }
		.header .hero { font-size: 2rem; font-weight: 600; margin: 8px 0; }
		.card { background: white; border-radius: 8px; padding: 16px; margin-bottom: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); overflow-x: auto; }
		.card h2 { margin: 0 0 12px 0; font-size: 1rem; color: #374151; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px; }
		table { border-collapse: collapse; width: 100%; }
		td, th { padding: 4px 8px; text-align: left; }
		th { color: #6b7280; font-weight: 500; font-size: 0.85rem; border-bottom: 1px solid #e5e7eb; }
		tr:not(:last-child) td { border-bottom: 1px solid #f3f4f6; }
		.tree-name { white-space: nowrap; }
		.bar-track { background: #e5e7eb; border-radius: 4px; height: 8px; width: 100px; }
		.bar-fill { background: #86b6ef; border-radius: 0 4px 4px 0; height: 8px; }
		.delta-up { color: #d03b3b; }
		.delta-down { color: #2a78d6; }
		.delta-flat { color: #6b7280; }
		ul { margin: 0; padding-left: 20px; }
		.muted { color: #6b7280; }
		h3 { font-size: 0.9rem; color: #4b5563; margin: 12px 0 4px; }
		@media (prefers-color-scheme: dark) {
			body { background: #1a1a19; color: #e5e7eb; }
			.card { background: #262624; box-shadow: none; }
			.card h2 { color: #e5e7eb; border-bottom-color: #3a3a38; }
			th { color: #9ca3af; border-bottom-color: #3a3a38; }
			tr:not(:last-child) td { border-bottom-color: #2e2e2c; }
			.bar-track { background: #3a3a38; }
			.bar-fill { background: #3987e5; }
			.delta-up { color: #d03b3b; }
			.delta-down { color: #3987e5; }
			.delta-flat { color: #9ca3af; }
			h3 { color: #cbd5e1; }
		}
	</style>
</head>
<body>
<div class="container">
	<div class="header">
		<h1>${escapeHtml(first.scenario)}</h1>
		<div class="meta">${first.positronVersion ? `Build: ${escapeHtml(first.positronVersion)}` : ''}</div>
		<div class="hero">${formatBytes(total)}</div>
		<div class="meta">${baseline ? deltaHtml(total, baseline.treeTotalPssBytes) : 'no baseline'} vs previous nightly</div>
	</div>

	<div class="card">
		<h2>By role</h2>
		<table>
			<tr><th>Role</th><th align="right">PSS</th><th></th><th align="right">Change</th></tr>
			${roleRows}
		</table>
	</div>

	<div class="card">
		<h2>Process tree</h2>
		<table>
			<tr><th>Process</th><th>Role</th><th align="right">PSS</th><th></th><th align="right">RSS</th><th align="right">PID</th></tr>
			${treeRows}
		</table>
	</div>

	<div class="card">
		<h2>Activated extensions (${first.extensions.length})</h2>
		${extensionsByEvent}
	</div>
</div>
</body>
</html>`;
}
