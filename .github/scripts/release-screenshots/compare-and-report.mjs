/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { readdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extname, join } from 'node:path';

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

export async function classify(generatedDir, docsDir) {
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
		if (!name.endsWith('.png')) {
			continue;
		}
		const genBuf = await readPng(join(generatedDir, name));
		const generatedHash = sha256(genBuf);

		// First try exact-name match: enables deterministic byte-level diff.
		const exactDocsBuf = await readPngIfExists(join(docsDir, name));
		if (exactDocsBuf !== null) {
			const docsHash = sha256(exactDocsBuf);
			const status = generatedHash === docsHash ? 'unchanged' : 'changed';
			result[name] = {
				status,
				generatedHash,
				generatedSize: genBuf.length,
				docsName: name,
				docsHash,
			};
			continue;
		}

		// Fall back to a different known extension (e.g. existing .jpeg).
		const counterpart = await findDocsCounterpart(docsEntries, name);
		if (counterpart) {
			result[name] = {
				status: 'changed',
				generatedHash,
				generatedSize: genBuf.length,
				docsName: counterpart,
			};
			continue;
		}

		result[name] = { status: 'new', generatedHash, generatedSize: genBuf.length };
	}
	return result;
}

const DOCS_IMAGE_BASE_URL = 'https://positron.posit.co/images';
const THUMBNAIL_WIDTH = 400;

function imageCell(url) {
	return `<img src="${url}" width="${THUMBNAIL_WIDTH}">`;
}

export function formatSummary(classification, opts = {}) {
	const screenshotBaseUrl = opts.screenshotBaseUrl ?? process.env.SCREENSHOT_BASE_URL;
	const entries = Object.entries(classification);
	if (entries.length === 0) {
		return '## Release screenshots\n\nNo images were generated.\n';
	}
	const counts = { unchanged: 0, changed: 0, new: 0 };
	for (const info of Object.values(classification)) {
		counts[info.status]++;
	}
	const totals = `${counts.unchanged} unchanged, ${counts.changed} changed, ${counts.new} new`;
	const heading = `Compared against \`posit-dev/positron-website\` \`images/\`. Totals: ${totals}.`;

	if (counts.changed === 0 && counts.new === 0) {
		return [
			'## Release screenshots',
			'',
			`${heading} No visual differences.`,
			'',
		].join('\n');
	}

	const rows = entries
		.sort(([a], [b]) => a.localeCompare(b))
		.filter(([, info]) => info.status !== 'unchanged')
		.map(([name, info]) => {
			const emoji = STATUS_EMOJI[info.status];
			const docsRef = info.docsName ?? name;
			const beforeUrl = `${DOCS_IMAGE_BASE_URL}/${docsRef}`;
			const afterUrl = screenshotBaseUrl ? `${screenshotBaseUrl}/${name}` : null;
			const beforeCell = info.status === 'new' ? '—' : imageCell(beforeUrl);
			const afterCell = afterUrl ? imageCell(afterUrl) : '—';
			const fileLabel = info.docsName && info.docsName !== name
				? `\`${name}\` <br><sub>replaces \`${info.docsName}\`</sub>`
				: `\`${name}\``;
			return `| ${emoji} | ${fileLabel} | ${beforeCell} | ${afterCell} |`;
		})
		.join('\n');

	return [
		'## Release screenshots',
		'',
		heading,
		'',
		'| | File | Current (positron.posit.co) | New (this run) |',
		'|---|---|---|---|',
		rows,
		'',
	].join('\n');
}

async function main() {
	const [generatedDir, docsDir, jsonOut] = process.argv.slice(2);
	if (!generatedDir || !docsDir || !jsonOut) {
		console.error('Usage: compare-and-report.mjs <generatedDir> <docsImagesDir> <jsonOutPath>');
		process.exit(2);
	}
	const result = await classify(generatedDir, docsDir);
	await writeFile(jsonOut, JSON.stringify(result, null, 2));
	const summary = formatSummary(result);
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
	const outputs = `changed_count=${counts.changed}\nnew_count=${counts.new}\n`;
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
