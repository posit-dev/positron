/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pieces shared by every memory HTML report -- the per-scenario report in
 * `render.ts` and the cross-scenario summary in `summary.ts`.
 *
 * Pulled out on purpose so the two reports cannot drift apart visually: a
 * color or a delta rule changed in one place and not the other would make the
 * summary look like a different product from the report it is meant to sit
 * alongside.
 */

const MB = 1024 * 1024;

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
 * Up/down triangle plus a signed number, so a delta is never conveyed by color
 * alone. Near-zero (under 1 MB) gets neither color nor glyph, just a plain
 * number, since a swing that small is noise rather than signal.
 */
export function deltaHtmlFromDiff(diff: number): string {
	const cls = Math.abs(diff) < MB ? 'delta-flat' : diff > 0 ? 'delta-up' : 'delta-down';
	const glyph = Math.abs(diff) < MB ? '' : diff > 0 ? '&#9650; ' : '&#9660; ';
	return `<span class="${cls}">${glyph}${signed(diff)}</span>`;
}

/** Same as {@link deltaHtmlFromDiff}, computing the diff from two absolute values. */
export function deltaHtml(current: number, before: number): string {
	return deltaHtmlFromDiff(current - before);
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
		table { border-collapse: collapse; width: 100%; }
		td, th { padding: 4px 8px; text-align: left; }
		th { color: #6b7280; font-weight: 500; font-size: 0.85rem; border-bottom: 1px solid #e5e7eb; }
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
		}`;
