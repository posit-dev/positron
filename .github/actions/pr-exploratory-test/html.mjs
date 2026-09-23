/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Renders the report as a page. The markdown stays beside it: the verification
// pass reads report.md, and a file you can grep is worth keeping.

import { marked } from 'marked';

/**
 * Copied from test/e2e/utils/memory/report-shell.ts so both reports look like
 * one product. It lives in the e2e suite as TypeScript, which this action
 * cannot import, so this is a copy rather than a shared module -- the memory
 * report is its source of truth.
 */
const REPORT_CSS = `
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

/**
 * Rules the markdown body needs and the memory report does not, because that
 * one builds its own cards rather than rendering prose.
 */
const BODY_CSS = `
		.header .summary { margin-top: 12px; }
		.header .summary .line { margin: 4px 0; line-height: 1.45; }
		.header .summary strong { color: #fff; }
		.card table { margin: 8px 0 16px; }
		.card th { border-bottom: 1px solid #e5e7eb; font-weight: 600; }
		.card td { border-bottom: 1px solid #f3f4f6; vertical-align: top; }
		.card td:first-child, .card th:first-child { padding-left: 0; }
		.card img { max-width: 100%; border: 1px solid #e5e7eb; border-radius: 4px; margin: 8px 0; }
		.card blockquote { margin: 8px 0; padding: 5px 12px; border-left: 3px solid #d1d5db; color: #6b7280; background: #f9fafb; font-size: 0.9rem; }
		.card code { background: #f3f4f6; padding: 1px 4px; border-radius: 3px; font-size: 0.9em; }
		.card pre { background: #f3f4f6; padding: 10px; border-radius: 4px; overflow-x: auto; }
		.card pre code { background: none; padding: 0; }
		.card details { margin: 12px 0; }
		.card summary { cursor: pointer; font-weight: 600; color: #374151; padding: 6px 0; }
		.card h2 { margin-top: 20px; }
		.card h3 { font-size: 1.1rem; font-weight: 600; color: #111827; margin: 28px 0 10px; padding-top: 16px; border-top: 1px solid #f3f4f6; }
		.card h3:first-of-type { border-top: none; padding-top: 0; }
		@media (prefers-color-scheme: dark) {
			.card th { border-bottom-color: #374151; }
			.card td { border-bottom-color: #1f2937; }
			.card code, .card pre { background: #111827; }
			.card blockquote { background: #111827; border-left-color: #374151; color: #9ca3af; }
			.card summary { color: #e5e7eb; }
			.card h3 { color: #f3f4f6; border-top-color: #1f2937; }
		}`;

function escapeHtml(text) {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

/**
 * Wraps the report's markdown in the shared shell.
 *
 * The title and the branch line are lifted out of the markdown so the page has
 * a header like the memory report's, and are dropped from the body so they do
 * not appear twice. `<details>` survives because marked passes raw HTML
 * through, which is what keeps Run details and Verification collapsed.
 */
export function renderReportHtml(markdown) {
	const lines = String(markdown ?? '').split('\n');
	const titleIndex = lines.findIndex(l => l.startsWith('# '));
	const title = titleIndex === -1 ? 'Exploratory test' : lines[titleIndex].slice(2).trim();
	// The line under the title is `<branch>` | `<sha>`; it belongs in the header.
	const metaIndex = lines.findIndex((l, i) => i > titleIndex && l.trim().startsWith('`'));
	const meta = metaIndex === -1 ? '' : lines[metaIndex].trim();
	// Result, Tested and Not exercised sit on consecutive lines with no blank
	// line between them, which markdown folds into one paragraph: three labels
	// running into each other mid-sentence. They are the summary, so lift them
	// into the header and give each its own line.
	const firstSection = lines.findIndex(l => l.startsWith('## '));
	const summaryIndexes = [];
	lines.forEach((line, i) => {
		if (i > titleIndex && (firstSection === -1 || i < firstSection) && /^\*\*[^*]+:\*\*/.test(line.trim())) {
			summaryIndexes.push(i);
		}
	});
	const summary = summaryIndexes
		.map(i => `<div class="line">${marked.parseInline(lines[i].trim())}</div>`)
		.join('\n\t\t');
	const dropped = new Set([titleIndex, metaIndex, ...summaryIndexes]);
	const body = lines
		.filter((_, i) => !dropped.has(i))
		.join('\n');

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${REPORT_CSS}${BODY_CSS}</style>
</head>
<body>
<div class="container">
	<div class="header">
		<h1>${escapeHtml(title)}</h1>
		<div class="meta">${marked.parseInline(meta)}</div>
		${summary ? `<div class="summary">\n\t\t${summary}\n\t\t</div>` : ''}
	</div>
	<div class="card">
${marked.parse(body)}
	</div>
</div>
</body>
</html>
`;
}
