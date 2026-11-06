/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import { join } from 'path';
import yauzl from 'yauzl';
import type { SecretValue } from './appEnv';
import { encodedForms, toLatin1Needle, type SecretEncoding } from './secretScrub';

export interface ScanHit {
	file: string;
	name: string;
	encoding: SecretEncoding;
}

/** Reads every file entry of a zip held in memory. */
function readZipEntries(zip: Buffer, label: string): Promise<{ path: string; data: Buffer }[]> {
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

async function scanData(label: string, data: Buffer, secrets: SecretValue[], hits: Map<string, ScanHit>): Promise<void> {
	if (label.toLowerCase().endsWith('.zip')) {
		for (const entry of await readZipEntries(data, label)) {
			await scanData(`${label}!${entry.path}`, entry.data, secrets, hits);
		}
		return;
	}
	const text = data.toString('latin1');
	for (const { name, value } of secrets) {
		for (const { encoding, text: form } of encodedForms(value)) {
			if (text.includes(toLatin1Needle(form))) {
				hits.set(`${label}\0${name}\0${encoding}`, { file: label, name, encoding });
			}
		}
	}
}

async function scanPath(path: string, secrets: SecretValue[], hits: Map<string, ScanHit>): Promise<void> {
	let stat;
	try {
		stat = await fs.lstat(path);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
			return;
		}
		throw err;
	}
	if (stat.isSymbolicLink()) {
		return;
	}
	if (stat.isDirectory()) {
		for (const child of await fs.readdir(path)) {
			await scanPath(join(path, child), secrets, hits);
		}
	} else if (stat.isFile()) {
		await scanData(path, await fs.readFile(path), secrets, hits);
	}
}

/**
 * Looks for secret values in files and zips (nested too) under `paths`. Reports names only.
 * Missing paths are skipped. Unreadable files or zips throw, so callers fail closed.
 */
export async function scanPaths(paths: string[], secrets: SecretValue[]): Promise<ScanHit[]> {
	const hits = new Map<string, ScanHit>();
	for (const path of paths) {
		await scanPath(path, secrets, hits);
	}
	return [...hits.values()];
}
