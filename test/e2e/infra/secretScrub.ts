/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createWriteStream, promises as fs } from 'fs';
import { join } from 'path';
import yauzl from 'yauzl';
import yazl from 'yazl';
import type { SecretValue } from './appEnv';

export type SecretEncoding = 'raw' | 'json' | 'url' | 'base64';

const MIN_FORM_LENGTH = 8;

/**
 * Base64 of the secret as it appears inside a longer blob at byte offset 0, 1 or 2 (mod 3).
 * Keeps only the characters fixed by the secret's own bytes, so surrounding bytes cannot break the match.
 */
function midBlobBase64(value: string): string[] {
	const bytes = Buffer.from(value, 'utf8');
	return [0, 1, 2].map(filler => {
		const encoded = Buffer.concat([Buffer.alloc(filler, 0x78), bytes]).toString('base64');
		return encoded.slice(Math.ceil((8 * filler) / 6), Math.floor((8 * (filler + bytes.length)) / 6));
	});
}

/** The forms a secret can take once it is written into a log. */
export function encodedForms(value: string): { encoding: SecretEncoding; text: string }[] {
	const candidates: { encoding: SecretEncoding; text: string }[] = [
		{ encoding: 'raw', text: value },
		{ encoding: 'json', text: JSON.stringify(value).slice(1, -1) },
		{ encoding: 'url', text: encodeURIComponent(value) },
		{ encoding: 'base64', text: Buffer.from(value, 'utf8').toString('base64') },
		...midBlobBase64(value).map(text => ({ encoding: 'base64' as const, text })),
	];
	const seen = new Set<string>();
	return candidates.filter(({ text }) => {
		if (text.length < MIN_FORM_LENGTH || seen.has(text)) {
			return false;
		}
		seen.add(text);
		return true;
	});
}

/** latin1 maps bytes 1:1, so searching a latin1 string works on any binary content. */
export function toLatin1Needle(text: string): string {
	return Buffer.from(text, 'utf8').toString('latin1');
}

/** Replaces secret values with `***`. Returns the same Buffer when nothing matched. */
export function scrubBuffer(data: Buffer, secrets: SecretValue[]): { data: Buffer; replaced: number } {
	const needles = [...new Set(secrets.flatMap(s => encodedForms(s.value).map(f => toLatin1Needle(f.text))))]
		.sort((a, b) => b.length - a.length);

	let text = data.toString('latin1');
	let replaced = 0;
	for (const needle of needles) {
		const parts = text.split(needle);
		if (parts.length > 1) {
			replaced += parts.length - 1;
			text = parts.join('***');
		}
	}
	return replaced === 0 ? { data, replaced } : { data: Buffer.from(text, 'latin1'), replaced };
}

/** Scrubs every regular file under `dir` in place. Returns the total replacement count. */
export async function scrubDirectory(dir: string, secrets: SecretValue[]): Promise<number> {
	let total = 0;
	let entries;
	try {
		entries = await fs.readdir(dir, { withFileTypes: true });
	} catch {
		return 0;
	}
	for (const entry of entries) {
		const full = join(dir, entry.name);
		if (entry.isSymbolicLink()) {
			continue;
		}
		if (entry.isDirectory()) {
			total += await scrubDirectory(full, secrets);
		} else if (entry.isFile()) {
			let content: Buffer;
			try {
				content = await fs.readFile(full);
			} catch {
				continue;
			}
			const { data, replaced } = scrubBuffer(content, secrets);
			if (replaced > 0) {
				await fs.writeFile(full, data);
				total += replaced;
			}
		}
	}
	return total;
}

/** Reads every file entry of a zip held in memory. */
export function readZipEntries(zip: Buffer, label: string): Promise<{ path: string; data: Buffer }[]> {
	return new Promise((resolve, reject) => {
		yauzl.fromBuffer(zip, { lazyEntries: true }, (openErr, zipfile) => {
			if (openErr || !zipfile) {
				reject(new Error(`cannot read zip ${label}: ${openErr?.message ?? 'unknown error'}`));
				return;
			}
			const entries: { path: string; data: Buffer }[] = [];
			const fail = (err: Error) => {
				zipfile.close();
				reject(new Error(`cannot read zip ${label}: ${err.message}`));
			};
			zipfile.on('error', fail);
			zipfile.on('end', () => resolve(entries));
			zipfile.on('entry', (entry: yauzl.Entry) => {
				if (entry.fileName.endsWith('/')) {
					zipfile.readEntry();
					return;
				}
				zipfile.openReadStream(entry, (streamErr, stream) => {
					if (streamErr || !stream) {
						fail(streamErr ?? new Error('no stream'));
						return;
					}
					const chunks: Buffer[] = [];
					stream.on('data', (chunk: Buffer) => chunks.push(chunk));
					stream.on('error', fail);
					stream.on('end', () => {
						entries.push({ path: entry.fileName, data: Buffer.concat(chunks) });
						zipfile.readEntry();
					});
				});
			});
			zipfile.readEntry();
		});
	});
}

/**
 * Scrubs every entry of a zip in place. Playwright traces record typed values raw
 * (action params, action log, DOM snapshots), so trace zips need this before upload.
 * Returns the replacement count; the file is rewritten only when something matched.
 */
export async function scrubZip(zipPath: string, secrets: SecretValue[]): Promise<number> {
	const entries = await readZipEntries(await fs.readFile(zipPath), zipPath);
	const out = new yazl.ZipFile();
	let total = 0;
	for (const entry of entries) {
		const { data, replaced } = scrubBuffer(entry.data, secrets);
		total += replaced;
		out.addBuffer(data, entry.path);
	}
	if (total === 0) {
		return 0;
	}
	const tmp = `${zipPath}.scrub`;
	await new Promise<void>((resolve, reject) => {
		out.outputStream.pipe(createWriteStream(tmp)).on('close', resolve).on('error', reject);
		out.end();
	});
	await fs.rename(tmp, zipPath);
	return total;
}
