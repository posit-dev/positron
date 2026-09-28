/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// The explorer blurs a key the app shows before it takes a screenshot, and
// publishing replaces key values in text files. This is the check behind
// both: it reads each screenshot with OCR, and where one still shows a
// credential's value it paints over the words that show it, then reads the
// shot again. A shot it cannot clean that way, because the key still reads or
// the image is not a PNG, is removed (CI) or stops the publish (local), as a
// text file redaction fails on is.
//
// Usage:
//   node scan-shots.mjs <dir> [--remove]   paints what it can; exits 1 when a
//                                          shot still shows a value
//   node scan-shots.mjs --names            prints the variable names it checks
//
// Names are printed, values never are.

import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { availableParallelism } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

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

/** Shorter pieces of a key would match ordinary words. */
const FRAGMENT = 6;

/** The smallest box around all of `boxes`. */
function union(boxes) {
	return {
		x0: Math.min(...boxes.map(b => b.x0)), y0: Math.min(...boxes.map(b => b.y0)),
		x1: Math.max(...boxes.map(b => b.x1)), y1: Math.max(...boxes.map(b => b.y1)),
	};
}

/**
 * The shortest run of adjacent words that shows `value` together, for a key
 * OCR split into pieces too short to match alone. OCR can join text from two
 * panes at one height into a single line, so the line's own box can span half
 * the window; the words the key is in cannot.
 */
function wordSpan(words, value) {
	let best = null;
	for (let i = 0; i < words.length; i++) {
		for (let j = i; j < words.length && (!best || j - i < best.length); j++) {
			const span = words.slice(i, j + 1);
			if (showsValue(span.map(w => w.text).join(''), value)) {
				best = span;
				break;
			}
		}
	}
	return best;
}

/**
 * The boxes to paint in one shot, from OCR's lines and words: every word that
 * shows a secret, or failing that the shortest run of words that does, and,
 * once one is found, any word of six or more characters that is how the key
 * starts or ends, which is how a key wrapped onto a second line reads. Only
 * the ends: a piece from the middle of a URL or a name can be an ordinary word.
 */
export function boxesToPaint(lines, secrets) {
	const boxes = [];
	for (const { value } of secrets) {
		const key = fold(value).replace(/[^a-z0-9]/g, '');
		let found = false;
		for (const line of lines) {
			const hits = line.words.filter(w => showsValue(w.text, value));
			const span = hits.length ? null : showsValue(line.text, value) && wordSpan(line.words, value);
			if (hits.length) {
				boxes.push(...hits.map(w => w.bbox));
			} else if (span) {
				boxes.push(union(span.map(w => w.bbox)));
			} else if (showsValue(line.text, value)) {
				boxes.push(line.bbox);
			} else {
				continue;
			}
			found = true;
		}
		if (found) {
			for (const line of lines) {
				for (const w of line.words) {
					const piece = fold(w.text).replace(/[^a-z0-9]/g, '');
					if (piece.length >= FRAGMENT && (key.startsWith(piece) || key.endsWith(piece))) {
						boxes.push(w.bbox);
					}
				}
			}
		}
	}
	return boxes;
}

/** A PNG with each box, padded by `pad` pixels, filled solid black. */
export function paintBoxes(png, boxes, pad = 3) {
	const image = PNG.sync.read(png);
	for (const { x0, y0, x1, y1 } of boxes) {
		for (let y = Math.max(0, y0 - pad); y < Math.min(image.height, y1 + pad); y++) {
			for (let x = Math.max(0, x0 - pad); x < Math.min(image.width, x1 + pad); x++) {
				const i = (y * image.width + x) * 4;
				image.data[i] = image.data[i + 1] = image.data[i + 2] = 0;
				image.data[i + 3] = 255;
			}
		}
	}
	return PNG.sync.write(image);
}

const showing = (text, secrets) => secrets.filter(s => showsValue(text, s.value)).map(s => s.name);

/**
 * Checks and cleans one shot: `clean` when it shows no secret, `painted` when
 * painting removed every one it showed, `leak` when one still reads (or it is
 * not a PNG, so it cannot be painted), `unreadable` when OCR failed. A shot a
 * scan skipped would pass a file nobody checked, so unreadable counts as a leak.
 */
async function checkShot(file, secrets, read) {
	let first;
	try {
		first = await read(file);
	} catch {
		return { file, names: ['(unreadable)'], status: 'unreadable' };
	}
	const names = showing(first.text, secrets);
	if (!names.length) {
		return { file, names, status: 'clean' };
	}
	const shown = secrets.filter(s => names.includes(s.name));
	const boxes = /\.png$/i.test(file) ? boxesToPaint(first.lines, shown) : [];
	if (!boxes.length) {
		return { file, names, status: 'leak' };
	}
	writeFileSync(file, paintBoxes(readFileSync(file), boxes));
	try {
		const still = showing((await read(file)).text, shown);
		return still.length ? { file, names: still, status: 'leak' } : { file, names, status: 'painted' };
	} catch {
		return { file, names, status: 'unreadable' };
	}
}

/**
 * Every screenshot under `dir` that showed a secret, with what became of it.
 * Shots that showed none are left out. Painting changes the file in place, so
 * point this at a copy when the originals matter.
 */
export async function scanShots(dir, secrets, read) {
	// All at once: the reader queues them across its workers.
	const results = await Promise.all(images(dir).map(file => checkShot(file, secrets, read)));
	return results.filter(r => r.status !== 'clean');
}

/** OCR's lines and words, with their boxes, flattened out of its blocks. */
function linesOf(data) {
	return (data.blocks ?? []).flatMap(b => b.paragraphs).flatMap(p => p.lines)
		.map(l => ({ text: l.text, bbox: l.bbox, words: l.words.map(w => ({ text: w.text, bbox: w.bbox })) }));
}

/**
 * An OCR reader backed by tesseract.js and its bundled English data, so it
 * runs offline. A 1600x1100 shot takes about a second on one worker.
 */
export async function createReader(workers = Math.min(4, availableParallelism())) {
	const { createScheduler, createWorker } = await import('tesseract.js');
	const require = createRequire(import.meta.url);
	const langPath = join(dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int');
	const scheduler = createScheduler();
	for (let i = 0; i < workers; i++) {
		scheduler.addWorker(await createWorker('eng', 1, { langPath, cacheMethod: 'none' }));
	}
	return {
		read: async file => {
			const { data } = await scheduler.addJob('recognize', file, {}, { text: true, blocks: true });
			return { text: data.text, lines: linesOf(data) };
		},
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
	const ocr = await createReader();
	let results;
	try {
		results = await scanShots(dir, secrets, ocr.read);
	} finally {
		await ocr.close();
	}
	const remove = args.includes('--remove');
	let leaks = 0;
	for (const { file, names, status } of results) {
		const where = relative(dir, file);
		if (status === 'painted') {
			console.log(`scan-shots: painted over ${names.join(', ')} in ${where}.`);
		} else if (remove) {
			rmSync(file);
			console.log(`::warning title=Screenshot removed::${where} shows ${names.join(', ')} and could not be painted over; removed before publishing.`);
		} else {
			leaks++;
			console.error(`scan-shots: ${where} shows ${names.join(', ')} and could not be painted over.`);
		}
	}
	console.log(`scan-shots: ${results.length} screenshots under ${dir} showed a credential; ${results.filter(r => r.status === 'painted').length} painted over.`);
	return leaks ? 1 : 0;
}

// 1 means a shot still shows a value; anything else means the scan itself
// failed, which a caller must not report as a leak.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	try {
		process.exitCode = await main(process.argv.slice(2));
	} catch (err) {
		console.error(`scan-shots: the scan failed: ${err}`);
		process.exitCode = 3;
	}
}
