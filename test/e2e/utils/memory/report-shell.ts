/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pieces shared by every memory HTML report -- the per-scenario report in
 * `render.ts` and the scenario memory report in `summary.ts`.
 *
 * Pulled out on purpose so the two reports cannot drift apart visually: a
 * color or a delta rule changed in one place and not the other would make the
 * summary look like a different product from the report it is meant to sit
 * alongside.
 */

export const KB = 1024;
const MB = 1024 * KB;

/** Shown by the per-scenario report whenever a snapshot carries a forced-GC reading, so live usage is not mistaken for it. */
export const GC_NOTE = 'Shared process and extension host values are measured after forced garbage collection; live usage may be higher.';

/**
 * The same caveat as {@link GC_NOTE} for the summary matrix, which marks the
 * affected roles with an asterisk instead of naming them in prose. Kept next to
 * GC_NOTE so the two cannot end up making different claims about the same reading.
 */
export const GC_FOOTNOTE = 'Measured after forced garbage collection; live usage may be higher.';

/**
 * Always MB, never GB. Every scenario in the report sits in the hundreds to
 * low thousands of MB, and a GB branch collapses exactly the resolution the
 * report exists to show: at gigabyte scale one displayed digit is worth over
 * 100 MB, which would hide a regression the size of the effort's own worked
 * examples (a duckdb worker at 86 MB, a language server at 101 MB).
 */
export function formatBytes(bytes: number): string {
	const mb = bytes / MB;
	return `${mb.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} MB`;
}

export function signed(bytes: number): string {
	const sign = bytes >= 0 ? '+' : '-';
	return `${sign}${formatBytes(Math.abs(bytes))}`;
}

export function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/**
 * Up/down triangle plus a number, so a delta is never conveyed by color alone.
 *
 * The glyph carries the direction, so the sign would only repeat it. Near-zero
 * (under 1 MB) gets neither color nor glyph, just a plain number, since a swing
 * that small is noise rather than signal -- and there the sign is the only thing
 * saying which way it went, so it stays.
 */
export function deltaHtmlFromDiff(diff: number): string {
	const flat = Math.abs(diff) < MB;
	const cls = flat ? 'delta-flat' : diff > 0 ? 'delta-up' : 'delta-down';
	const glyph = flat ? '' : diff > 0 ? '&#9650; ' : '&#9660; ';
	return `<span class="${cls}">${glyph}${flat ? signed(diff) : formatBytes(Math.abs(diff))}</span>`;
}

/** Same as {@link deltaHtmlFromDiff}, computing the diff from two absolute values. */
export function deltaHtml(current: number, before: number): string {
	return deltaHtmlFromDiff(current - before);
}

/**
 * The card both reports use to say their figures are medians of a moving
 * process, differing only in columns: the summary names the scenario, the
 * per-scenario report shows the spread.
 *
 * Shared so the two cannot describe the same defect differently. A reader who
 * follows the summary's warning into a scenario report should meet the same
 * claim, not a second opinion.
 */
export function notSteadyStateCardHtml(headers: string[], rows: string): string {
	const headerCells = headers
		.map(header => (header.startsWith('#') ? `<th align="right">${header.slice(1)}</th>` : `<th>${header}</th>`))
		.join('');
	return `<div class="card warn-card">
		<h2>Not a steady state</h2>
		<div class="meta">Sampling waits for every large process to hold steady, and for these it gave up first. The
		figures reported for them are medians of a range rather than settled numbers, so treat this run's totals and
		deltas as unreliable.</div>
		<table>
			<tr>${headerCells}</tr>
			${rows}
		</table>
	</div>`;
}

/**
 * The CSS both reports use. Kept as one string so a color tweak lands in both
 * places at once rather than needing two coordinated edits.
 */
export const REPORT_CSS = `
		body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 16px; background: #f9fafb; color: #374151; }
		.container { max-width: 960px; margin: 0 auto; }
		.header { background: #1f2937; color: white; padding: 16px 20px; border-radius: 8px; margin-bottom: 16px; }
		.header h1 { margin: 0 0 8px 0; font-size: 1.5rem; }
		.header .meta { opacity: 0.85; font-size: 0.9rem; }
		.header .hero { font-size: 2rem; font-weight: 600; margin: 8px 0; }
		.card { background: white; border-radius: 8px; padding: 16px; margin-bottom: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); overflow-x: auto; }
		.card h2 { margin: 0 0 12px 0; font-size: 1rem; color: #374151; border-bottom: 1px solid #e5e7eb; padding-bottom: 8px; }
		/* Same card tier, only a status accent: this warning ranks with the other sections, it is not a different kind of surface. */
		.warn-card { border-left: 3px solid #d97706; }
		.warn-card h2 { color: #b45309; }
		/* Only .header .meta was styled, so a card's own .meta read as body copy and sat flush against the table below it. */
		.card .meta { color: #6b7280; font-size: 0.9rem; margin-bottom: 12px; }
		table { border-collapse: collapse; width: 100%; }
		td, th { padding: 4px 8px; text-align: left; }
		/* Both reports mark numeric cells with align="right", which the rule above was
		silently overriding -- CSS beats a presentational attribute -- so every figure
		rendered left-aligned and the decimal points did not line up to compare. */
		td[align="right"], th[align="right"] { text-align: right; }
		/* Proportional digits are not the same width, so even right-aligned figures put
		their decimal points in slightly different places down a column. */
		td[align="right"] { font-variant-numeric: tabular-nums; }
		/* Bolder and darker than the values are, but smaller: size keeps the header from
		competing with the data while weight still marks it as the label band. At 500 in
		light gray it read as just another row. */
		th { color: #4b5563; font-weight: 600; font-size: 0.85rem; border-bottom: 1px solid #e5e7eb; }
		tr:not(:last-child) td { border-bottom: 1px solid #f3f4f6; }
		.tree-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		.num-cell { white-space: nowrap; }
		/* Fixed layout + colgroup: sized columns hold, the name absorbs the slack. A max-width cannot, it guesses the viewport. */
		.tree-table { table-layout: fixed; }
		/* Every cell: a role like kernel_supervisor also outgrows its column and would overlap the PSS number. */
		.tree-table td { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		.bar-track { background: #e5e7eb; border-radius: 4px; height: 8px; width: 100px; }
		/* Fills its column instead of a fixed 100px, which the rule above would clip by the padding, shortening the longest bar most. */
		.tree-table .bar-track { width: 100%; }
		.bar-fill { background: #86b6ef; border-radius: 0 4px 4px 0; height: 8px; }
		/* Reads as a summary rather than one more row: a darker rule than the hairlines
		between rows, and air above it that the hairlines do not get. */
		.total-row td { border-top: 2px solid #d1d5db; font-weight: 600; padding-top: 10px; }
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
			.warn-card { border-left-color: #f59e0b; }
			.warn-card h2 { color: #fbbf24; }
			.card .meta { color: #9ca3af; }
			th { color: #d1d5db; border-bottom-color: #3a3a38; }
			tr:not(:last-child) td { border-bottom-color: #2e2e2c; }
			.total-row td { border-top-color: #4b5563; }
			.bar-track { background: #3a3a38; }
			.bar-fill { background: #3987e5; }
			.delta-up { color: #d03b3b; }
			.delta-down { color: #3987e5; }
			.delta-flat { color: #9ca3af; }
			h3 { color: #cbd5e1; }
		}`;
