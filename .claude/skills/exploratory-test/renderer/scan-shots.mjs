/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Publishing replaces credential values in text files, but a screenshot is an
// image, so a key the app showed on screen went out as is. This reads each
// screenshot with OCR and reports the ones that show a credential's value.
// It cannot blur the key out, so a match is dropped (CI) or stops the publish
// (local), the same way a text file redaction fails on is handled.
//
// Usage:
//   node scan-shots.mjs <dir> [--remove]   exits 1 when a shot shows a value
//   node scan-shots.mjs --names            prints the variable names it checks
//
// Names are printed, values never are.

import { readdirSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { availableParallelism } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Credentials CI holds under names the suffix rule misses. Widening the rule to
 * USER or URL would catch $USER and every harmless URL too.
 */
export const OTHER_NAMES = ['MS_FOUNDRY_BASE_URL', 'SNOWFLAKE_ACCOUNT', 'SNOWFLAKE_USER', 'DATABRICKS_WORKSPACE'];

/** Shorter values would match ordinary words on screen. */
const MIN_LENGTH = 8;

/** The environment's credentials, as `{ name, value }`. */
export function secretEnv(env) {
	return Object.keys(env)
		.filter(name => /(KEY|TOKEN|SECRET|PASSWORD|PAT)$/i.test(name) || OTHER_NAMES.includes(name))
		.sort()
		.map(name => ({ name, value: env[name] ?? '' }))
		.filter(({ value }) => value.length >= MIN_LENGTH);
}

// OCR confuses these, in both directions, and changes case freely: one run
// read `pL4vR8tNw3` as `pLAVRBINWS`. Folding both sides to one form lets the
// comparison ignore those substitutions.
const FOLD = { 0: 'o', 1: 'l', i: 'l', '|': 'l', '!': 'l', 4: 'a', 8: 'b', 3: 's', 5: 's', 2: 'z', 9: 'g', 6: 'g' };

/** Lower case, lookalikes folded, whitespace dropped (a long key wraps). */
export function fold(text) {
	return [...String(text).toLowerCase()].filter(c => !/\s/.test(c)).map(c => FOLD[c] ?? c).join('');
}

/** Fewest edits that turn `needle` into some substring of `hay` (Sellers). */
function substringDistance(needle, hay) {
	let prev = new Array(needle.length + 1).fill(0).map((_, i) => i);
	let best = prev[needle.length];
	for (const c of hay) {
		const cur = [0];
		for (let i = 1; i <= needle.length; i++) {
			cur[i] = Math.min(prev[i] + 1, cur[i - 1] + 1, prev[i - 1] + (needle[i - 1] === c ? 0 : 1));
		}
		best = Math.min(best, cur[needle.length]);
		prev = cur;
	}
	return best;
}

const WINDOW = 20;

/**
 * Whether OCR text shows `value`, or any 20-character stretch of it: a field
 * too narrow for the whole key still shows part of it. Up to 15% of a window
 * may differ, for what folding does not cover.
 */
export function showsValue(text, value) {
	const hay = fold(text);
	const needle = fold(value);
	const size = Math.min(WINDOW, needle.length);
	const slack = Math.floor(size * 0.15);
	for (let start = 0; start + size <= needle.length; start += Math.max(1, Math.floor(size / 4))) {
		if (substringDistance(needle.slice(start, start + size), hay) <= slack) {
			return true;
		}
	}
	return false;
}

const IMAGE = /\.(png|jpe?g|webp)$/i;

function images(dir) {
	return readdirSync(dir, { recursive: true })
		.map(p => join(dir, String(p)))
		.filter(p => IMAGE.test(p) && statSync(p).isFile())
		.sort();
}

/**
 * The screenshots under `dir` that show a secret, as `{ file, names }`. A shot
 * OCR cannot read is reported too, with the name `(unreadable)`: a scan that
 * skipped it would pass a file nobody checked.
 */
export async function scanShots(dir, secrets, recognize) {
	// All at once: the recognizer queues them across its workers.
	const results = await Promise.all(images(dir).map(async file => {
		try {
			const text = await recognize(file);
			return { file, names: secrets.filter(s => showsValue(text, s.value)).map(s => s.name) };
		} catch {
			return { file, names: ['(unreadable)'] };
		}
	}));
	return results.filter(r => r.names.length);
}

/**
 * An OCR function backed by tesseract.js and its bundled English data, so it
 * runs offline. A 1600x1100 shot takes about a second on one worker.
 */
export async function createRecognizer(workers = Math.min(4, availableParallelism())) {
	const { createScheduler, createWorker } = await import('tesseract.js');
	const require = createRequire(import.meta.url);
	const langPath = join(dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int');
	const scheduler = createScheduler();
	for (let i = 0; i < workers; i++) {
		scheduler.addWorker(await createWorker('eng', 1, { langPath, cacheMethod: 'none' }));
	}
	return {
		recognize: async file => (await scheduler.addJob('recognize', file)).data.text,
		close: () => scheduler.terminate(),
	};
}

async function main(args) {
	if (args[0] === '--names') {
		console.log([...new Set([...Object.keys(process.env).filter(n => /(KEY|TOKEN|SECRET|PASSWORD|PAT)$/i.test(n)), ...OTHER_NAMES])].sort().join('\n'));
		return 0;
	}
	const dir = args.find(a => !a.startsWith('--'));
	if (!dir) {
		console.error('usage: node scan-shots.mjs <dir> [--remove] | --names');
		return 2;
	}
	const secrets = secretEnv(process.env);
	if (!secrets.length) {
		console.log('scan-shots: no credentials in the environment; nothing to look for.');
		return 0;
	}
	const ocr = await createRecognizer();
	let hits;
	try {
		hits = await scanShots(dir, secrets, ocr.recognize);
	} finally {
		await ocr.close();
	}
	for (const { file, names } of hits) {
		const where = relative(dir, file);
		if (args.includes('--remove')) {
			rmSync(file);
			console.log(`::warning title=Screenshot removed::${where} shows ${names.join(', ')}; removed before publishing.`);
		} else {
			console.error(`scan-shots: ${where} shows ${names.join(', ')}.`);
		}
	}
	console.log(`scan-shots: ${hits.length} of the screenshots under ${dir} show a credential.`);
	return hits.length && !args.includes('--remove') ? 1 : 0;
}

// 1 means a shot shows a value; anything else means the scan itself failed,
// which a caller must not report as a leak.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	try {
		process.exitCode = await main(process.argv.slice(2));
	} catch (err) {
		console.error(`scan-shots: the scan failed: ${err}`);
		process.exitCode = 3;
	}
}
