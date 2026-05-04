/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { readdir, readFile, writeFile, appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const STATUS_EMOJI = {
	unchanged: '✅',
	changed: '🔄',
	new: '🆕',
};

function sha256(buf) {
	return createHash('sha256').update(buf).digest('hex');
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

export async function classify(generatedDir, docsDir) {
	const entries = await readdir(generatedDir);
	const result = {};
	for (const name of entries) {
		if (!name.endsWith('.png')) {
			continue;
		}
		const genBuf = await readPng(join(generatedDir, name));
		const generatedHash = sha256(genBuf);
		const docsBuf = await readPngIfExists(join(docsDir, name));
		if (docsBuf === null) {
			result[name] = { status: 'new', generatedHash, generatedSize: genBuf.length };
			continue;
		}
		const docsHash = sha256(docsBuf);
		const status = generatedHash === docsHash ? 'unchanged' : 'changed';
		result[name] = { status, generatedHash, generatedSize: genBuf.length, docsHash };
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
			const beforeUrl = `${DOCS_IMAGE_BASE_URL}/${name}`;
			const afterUrl = screenshotBaseUrl ? `${screenshotBaseUrl}/${name}` : null;
			const beforeCell = info.status === 'new' ? '—' : imageCell(beforeUrl);
			const afterCell = afterUrl ? imageCell(afterUrl) : '—';
			return `| ${emoji} | \`${name}\` | ${beforeCell} | ${afterCell} |`;
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
