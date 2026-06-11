/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { readdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extname, join } from 'node:path';
import { PNG } from 'pngjs';

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const KNOWN_IMAGE_EXTS = ['.png', '.jpg', '.jpeg'];

const STATUS_EMOJI = {
	unchanged: '✅',
	changed: '🔄',
	new: '🆕',
};

function sha256(buf) {
	return createHash('sha256').update(buf).digest('hex');
}

function basename(name) {
	return name.slice(0, name.length - extname(name).length);
}

async function readPng(path) {
	const buf = await readFile(path);
	if (buf.length === 0) {
		throw new Error(`PNG is empty: ${path}`);
	}
	if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) {
		throw new Error(`File is not a valid PNG (bad signature): ${path}`);
	}
	return buf;
}

/**
 * Generate a diff PNG visualising what changed between two screenshots.
 * - Changed pixels (max channel delta > threshold) → bright red
 * - Unchanged pixels → 30% brightness of the generated image
 *
 * Returns null if either buffer is not a parseable PNG or the images differ in size.
 * Otherwise returns { buf, changedRatio } where changedRatio is the fraction of
 * pixels (0–1) whose max channel delta exceeds the threshold.
 *
 * @param {Buffer} genBuf   raw generated PNG
 * @param {Buffer} docsBuf  raw docs PNG
 * @param {Array}  regions  reserved for future use
 * @param {{ threshold?: number }} opts  threshold defaults to 15 to suppress anti-aliasing noise
 * @returns {{ buf: Buffer, changedRatio: number }|null}
 */
export function generateDiff(genBuf, docsBuf, regions = [], { threshold = 15 } = {}) {
	let genPng, docsPng;
	try {
		genPng = PNG.sync.read(genBuf);
		docsPng = PNG.sync.read(docsBuf);
	} catch {
		return null;
	}
	if (genPng.width !== docsPng.width || genPng.height !== docsPng.height) {
		return null;
	}

	const diff = new PNG({ width: genPng.width, height: genPng.height });
	let changedPixels = 0;

	for (let row = 0; row < genPng.height; row++) {
		for (let col = 0; col < genPng.width; col++) {
			const i = (row * genPng.width + col) * 4;
			const delta = Math.max(
				Math.abs(genPng.data[i] - docsPng.data[i]),
				Math.abs(genPng.data[i + 1] - docsPng.data[i + 1]),
				Math.abs(genPng.data[i + 2] - docsPng.data[i + 2]),
			);
			if (delta > threshold) {
				changedPixels++;
				// Changed — red.
				diff.data[i] = 255;
				diff.data[i + 1] = 50;
				diff.data[i + 2] = 50;
				diff.data[i + 3] = 255;
			} else {
				// Unchanged — dim to 30% so changed pixels stand out.
				diff.data[i] = Math.round(genPng.data[i] * 0.3);
				diff.data[i + 1] = Math.round(genPng.data[i + 1] * 0.3);
				diff.data[i + 2] = Math.round(genPng.data[i + 2] * 0.3);
				diff.data[i + 3] = 255;
			}
		}
	}

	const totalPixels = genPng.width * genPng.height;
	return { buf: PNG.sync.write(diff), changedRatio: changedPixels / totalPixels };
}

async function readPngIfExists(path) {
	try {
		return await readPng(path);
	} catch (err) {
		if (err.code === 'ENOENT') {
			return null;
		}
		throw err;
	}
}

/**
 * Look for a docs file matching the generated PNG by basename, allowing the
 * docs file to use any of KNOWN_IMAGE_EXTS. Used so that a generated `foo.png`
 * can replace an existing `foo.jpeg` in positron-website without showing as
 * a "new" file every run.
 *
 * Returns the matching docs filename (e.g. 'foo.jpeg') or null.
 */
async function findDocsCounterpart(docsDirEntries, generatedName) {
	const base = basename(generatedName);
	for (const docsName of docsDirEntries) {
		if (docsName === generatedName) {
			continue;
		}
		if (basename(docsName) !== base) {
			continue;
		}
		if (KNOWN_IMAGE_EXTS.includes(extname(docsName).toLowerCase())) {
			return docsName;
		}
	}
	return null;
}

export async function classify(generatedDir, docsDir, opts = {}) {
	const generatedEntries = await readdir(generatedDir);
	let docsEntries = [];
	try {
		docsEntries = await readdir(docsDir);
	} catch (err) {
		if (err.code !== 'ENOENT') {
			throw err;
		}
	}
	const result = {};
	for (const name of generatedEntries) {
		if (!name.endsWith('.png') || /-diff\.png$/.test(name)) {
			continue;
		}
		const genBufRaw = await readPng(join(generatedDir, name));
		const generatedHash = sha256(genBufRaw);

		// First try exact-name match: enables deterministic byte-level diff.
		const exactDocsBuf = await readPngIfExists(join(docsDir, name));
		if (exactDocsBuf !== null) {
			const docsHash = sha256(exactDocsBuf);
			if (generatedHash === docsHash) {
				// Byte-identical — definitely unchanged, no pixel decode needed.
				result[name] = { status: 'unchanged', generatedHash, generatedSize: genBufRaw.length, docsName: name, docsHash };
				continue;
			}

			// Hashes differ — check whether pixels actually differ above threshold.
			// Metadata changes (compression, color profile, timestamps) can cause hash
			// mismatches even when images are visually identical.
			const diffResult = generateDiff(genBufRaw, exactDocsBuf);
			const status = (diffResult && diffResult.changedRatio === 0) ? 'unchanged' : 'changed';
			const entry = {
				status,
				generatedHash,
				generatedSize: genBufRaw.length,
				docsName: name,
				docsHash,
			};
			if (status === 'changed' && opts.writeDiffs && diffResult) {
				const diffName = name.replace(/\.png$/, '-diff.png');
				await writeFile(join(generatedDir, diffName), diffResult.buf);
				entry.diffName = diffName;
				entry.changedRatio = diffResult.changedRatio;
			}
			result[name] = entry;
			continue;
		}

		// Fall back to a different known extension (e.g. existing .jpeg).
		const counterpart = await findDocsCounterpart(docsEntries, name);
		if (counterpart) {
			const counterpartBuf = await readPngIfExists(join(docsDir, counterpart));
			const diffResult = counterpartBuf ? generateDiff(genBufRaw, counterpartBuf) : null;
			const status = (diffResult && diffResult.changedRatio === 0) ? 'unchanged' : 'changed';
			const entry = {
				status,
				generatedHash,
				generatedSize: genBufRaw.length,
				docsName: counterpart,
			};
			if (status === 'changed' && opts.writeDiffs && diffResult) {
				const diffName = name.replace(/\.png$/, '-diff.png');
				await writeFile(join(generatedDir, diffName), diffResult.buf);
				entry.diffName = diffName;
				entry.changedRatio = diffResult.changedRatio;
			}
			result[name] = entry;
			continue;
		}

		result[name] = { status: 'new', generatedHash, generatedSize: genBufRaw.length };
	}
	return result;
}

const DOCS_IMAGE_BASE_URL = process.env.DOCS_IMAGE_COMMIT_SHA
	? `https://raw.githubusercontent.com/posit-dev/positron-website/${process.env.DOCS_IMAGE_COMMIT_SHA}/images`
	: 'https://positron.posit.co/images'; // fallback for local runs
const THUMBNAIL_WIDTH = 400;

function imageCell(url) {
	return `<img src="${url}" width="${THUMBNAIL_WIDTH}">`;
}

export function formatSummary(classification, opts = {}) {
	const reportUrl = opts.reportUrl;
	const entries = Object.entries(classification);
	if (entries.length === 0) {
		return '📄 Screenshot Report\n\nNo images were generated.\n';
	}
	const counts = { unchanged: 0, changed: 0, new: 0 };
	for (const info of Object.values(classification)) {
		counts[info.status]++;
	}
	const total = counts.new + counts.changed + counts.unchanged;
	const totalsLine = [
		`🖼️ Total: ${total}`,
		`🆕 New: ${counts.new}`,
		`🔁 Changed: ${counts.changed}`,
		`⏭️ Unchanged: ${counts.unchanged}`,
	].join(' &nbsp;|&nbsp; ');
	const titleLine = reportUrl
		? `📄 [Screenshot Report](${reportUrl})`
		: '📄 Screenshot Report';
	return [
		titleLine,
		'',
		totalsLine,
		'',
	].join('\n');
}

const HTML_STATUS_LABEL = {
	unchanged: 'Unchanged',
	changed: 'Changed',
	new: 'New',
};

function htmlEscape(s) {
	return String(s).replace(/[&<>"']/g, (c) => (
		{ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]
	));
}

export function formatChangedRatio(ratio) {
	const pct = ratio * 100;
	if (pct === 0) {
		return '0%';
	}
	if (pct < 0.1) {
		return '< 0.1%';
	}
	return `${pct.toFixed(1)}%`;
}

function htmlCard(name, info, screenshotBaseUrl) {
	const docsRef = info.docsName ?? name;
	const beforeUrl = `${DOCS_IMAGE_BASE_URL}/${docsRef}`;
	const afterUrl = screenshotBaseUrl ? `${screenshotBaseUrl}/${name}` : null;
	const beforeFig = info.status === 'new'
		? '<div class="empty">— (not on positron.posit.co yet)</div>'
		: `<a href="${htmlEscape(beforeUrl)}" target="_blank" rel="noopener"><img loading="lazy" src="${htmlEscape(beforeUrl)}" alt="current"></a>`;
	const afterFig = afterUrl
		? `<a href="${htmlEscape(afterUrl)}" target="_blank" rel="noopener"><img loading="lazy" src="${htmlEscape(afterUrl)}" alt="new"></a>`
		: '<div class="empty">—</div>';
	const diffUrl = (info.diffName && screenshotBaseUrl)
		? `${screenshotBaseUrl}/${info.diffName}`
		: null;
	const ratioTag = info.changedRatio !== undefined
		? ` <span class="ratio-badge">${formatChangedRatio(info.changedRatio)} pixels changed</span>`
		: '';
	const diffFig = diffUrl
		? `<figure>
			<figcaption>Diff${ratioTag}</figcaption>
			<a href="${htmlEscape(diffUrl)}" target="_blank" rel="noopener"><img loading="lazy" src="${htmlEscape(diffUrl)}" alt="diff"></a>
		</figure>`
		: '';
	const replaces = info.docsName && info.docsName !== name
		? `<div class="card-replaces">replaces <code>${htmlEscape(info.docsName)}</code></div>`
		: '';
	return `
<div class="card">
	<div class="card-name"><code>${htmlEscape(name)}</code></div>
	${replaces}
	<div class="card-images${diffFig ? ' has-diff' : ''}">
		<figure>
			<figcaption>Current (positron.posit.co)</figcaption>
			${beforeFig}
		</figure>
		<figure>
			<figcaption>New (this run)</figcaption>
			${afterFig}
		</figure>
		${diffFig}
	</div>
</div>`;
}

function htmlSection(status, entries, screenshotBaseUrl, openByDefault) {
	const filtered = entries.filter(([, info]) => info.status === status);
	if (filtered.length === 0) {
		return '';
	}
	const label = HTML_STATUS_LABEL[status];
	const cards = filtered.map(([name, info]) => htmlCard(name, info, screenshotBaseUrl)).join('\n');
	return `
<details data-status="${status}"${openByDefault ? ' open' : ''}>
	<summary>${label} <span class="section-count">(${filtered.length})</span></summary>
	<div class="grid">${cards}</div>
</details>`;
}

export function formatHtml(classification, opts = {}) {
	const screenshotBaseUrl = opts.screenshotBaseUrl ?? process.env.SCREENSHOT_BASE_URL;
	const version = opts.version ?? process.env.POSITRON_VERSION;
	const entries = Object.entries(classification).sort(([a], [b]) => a.localeCompare(b));
	const counts = { unchanged: 0, changed: 0, new: 0 };
	for (const info of Object.values(classification)) {
		counts[info.status]++;
	}
	const sections = [
		htmlSection('new', entries, screenshotBaseUrl, true),
		htmlSection('changed', entries, screenshotBaseUrl, true),
		htmlSection('unchanged', entries, screenshotBaseUrl, false),
	].filter(Boolean).join('\n');

	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Release screenshots report</title>
<style>
	* { box-sizing: border-box; }
	body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, system-ui, sans-serif; margin: 0; padding: 16px; background: #f9fafb; color: #1a1a1a; }
	.container { max-width: 1400px; margin: 0 auto; }
	.header { background: #447099; color: white; padding: 16px 20px; border-radius: 8px; margin-bottom: 16px; }
	.header h1 { margin: 0 0 8px 0; font-size: 1.5rem; }
	.header .meta { opacity: 0.9; font-size: 0.9rem; }
	.totals { display: flex; gap: 12px; margin-bottom: 16px; flex-wrap: wrap; }
	.pill { padding: 6px 14px; border-radius: 999px; font-weight: 600; font-size: 13px; border: 2px solid transparent; cursor: pointer; font-family: inherit; transition: box-shadow 0.15s, transform 0.05s, opacity 0.15s; }
	.pill:hover { box-shadow: 0 0 0 3px rgba(68,112,153,0.15); }
	.pill:active { transform: translateY(1px); }
	.pill-unchanged { background: #d1fae5; color: #065f46; }
	.pill-changed { background: #fef3c7; color: #92400e; }
	.pill-new { background: #dbeafe; color: #1e40af; }
	.pill.is-active { border-color: currentColor; }
	body.is-filtered .pill:not(.is-active) { opacity: 0.4; }
	body.filter-changed details:not([data-status="changed"]),
	body.filter-new details:not([data-status="new"]),
	body.filter-unchanged details:not([data-status="unchanged"]) { display: none; }
	details { background: white; border-radius: 8px; padding: 16px 20px; margin-bottom: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
	summary { font-weight: 600; font-size: 1rem; color: #374151; cursor: pointer; user-select: none; padding-bottom: 12px; border-bottom: 1px solid #e5e7eb; margin-bottom: 16px; display: flex; align-items: center; gap: 10px; list-style: none; }
	summary::-webkit-details-marker { display: none; }
	summary::before { content: ''; display: inline-block; width: 0; height: 0; border-style: solid; border-width: 5px 0 5px 7px; border-color: transparent transparent transparent #9ca3af; transition: transform 0.15s ease; flex-shrink: 0; }
	details[open] > summary::before { transform: rotate(90deg); }
	details:not([open]) > summary { padding-bottom: 0; border-bottom: none; margin-bottom: 0; }
	.section-count { color: #9ca3af; font-weight: 500; }
	.grid { display: grid; gap: 16px; }
	.card { background: #f9fafb; border-radius: 6px; padding: 14px; border: 1px solid #e5e7eb; }
	.card-name { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; color: #374151; }
	.card-name code { background: transparent; padding: 0; }
	.card-replaces { color: #6b7280; font-size: 12px; margin-top: 2px; }
	.card-images { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 10px; }
	.card-images.has-diff { grid-template-columns: 1fr 1fr 1fr; }
	figure { margin: 0; }
	figcaption { font-size: 12px; color: #6b7280; margin-bottom: 6px; }
	img { max-width: 100%; height: auto; border: 1px solid #e5e7eb; border-radius: 4px; cursor: zoom-in; background: white; }
	.empty { font-style: italic; color: #9ca3af; padding: 8px 0; font-size: 13px; }
	.ratio-badge { background: #fee2e2; color: #991b1b; border-radius: 4px; padding: 1px 6px; font-size: 11px; font-weight: 600; white-space: nowrap; }
	code { background: #f3f4f6; padding: 1px 5px; border-radius: 3px; font-size: 0.9em; }
</style>
</head>
<body>
<div class="container">
<div class="header">
	<h1>Release Screenshots</h1>
	<div class="meta">${version ? `Positron <code style="background:rgba(255,255,255,0.2); color:white;">${htmlEscape(version)}</code> &nbsp;·&nbsp; ` : ''}Compared against <code style="background:rgba(255,255,255,0.2); color:white;">posit-dev/positron-website</code> <code style="background:rgba(255,255,255,0.2); color:white;">images/</code></div>
</div>
<div class="totals">
	<button class="pill pill-new" data-filter="new" type="button" aria-label="Filter to new">${counts.new} new</button>
	<button class="pill pill-changed" data-filter="changed" type="button" aria-label="Filter to changed">${counts.changed} changed</button>
	<button class="pill pill-unchanged" data-filter="unchanged" type="button" aria-label="Filter to unchanged">${counts.unchanged} unchanged</button>
</div>
${sections}
</div>
<script>
(() => {
	const pills = document.querySelectorAll('.pill[data-filter]');
	const body = document.body;
	pills.forEach((pill) => {
		pill.addEventListener('click', () => {
			const status = pill.dataset.filter;
			const wasActive = pill.classList.contains('is-active');
			pills.forEach((p) => p.classList.remove('is-active'));
			body.classList.remove('is-filtered', 'filter-changed', 'filter-new', 'filter-unchanged');
			if (!wasActive) {
				pill.classList.add('is-active');
				body.classList.add('is-filtered', 'filter-' + status);
				const target = document.querySelector('details[data-status="' + status + '"]');
				if (target) { target.open = true; }
			}
		});
	});
})();
</script>
</body>
</html>`;
}

async function main() {
	const [generatedDir, docsDir, jsonOut] = process.argv.slice(2);
	if (!generatedDir || !docsDir || !jsonOut) {
		console.error('Usage: compare-and-report.mjs <generatedDir> <docsImagesDir> <jsonOutPath>');
		process.exit(2);
	}
	const result = await classify(generatedDir, docsDir, { writeDiffs: true });
	await writeFile(jsonOut, JSON.stringify(result, null, 2));

	// Write the HTML report next to the generated screenshots so it gets
	// uploaded to S3 alongside them in the same workflow step.
	const html = formatHtml(result);
	const htmlPath = join(generatedDir, 'report.html');
	await writeFile(htmlPath, html);

	const screenshotBaseUrl = process.env.SCREENSHOT_BASE_URL;
	const reportUrl = screenshotBaseUrl ? `${screenshotBaseUrl}/report.html` : null;
	const summary = formatSummary(result, { reportUrl });
	const summaryPath = process.env.GITHUB_STEP_SUMMARY;
	if (summaryPath) {
		await appendFile(summaryPath, summary);
	} else {
		process.stdout.write(summary);
	}
	const counts = { changed: 0, new: 0 };
	for (const info of Object.values(result)) {
		if (info.status === 'changed') {
			counts.changed++;
		}
		if (info.status === 'new') {
			counts.new++;
		}
	}
	const outputPath = process.env.GITHUB_OUTPUT;
	const outputs = `changed_count=${counts.changed}
new_count=${counts.new}
`;
	if (outputPath) {
		await appendFile(outputPath, outputs);
	} else {
		process.stdout.write(outputs);
	}
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
