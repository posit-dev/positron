/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import { basename, join } from 'path';
import yauzl from 'yauzl';
import type { SecretValue } from './appEnv';
import { encodedForms, scrubBuffer, toLatin1Needle, type SecretEncoding } from './secretScrub';

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

function isZip(label: string, data: Buffer): boolean {
	const magic = data.subarray(0, 4);
	return label.toLowerCase().endsWith('.zip')
		|| magic.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
		|| magic.equals(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
}

/** `text` with secret values replaced by `***`, so labels and errors are safe to print. */
function redact(text: string, secrets: SecretValue[]): string {
	return scrubBuffer(Buffer.from(text, 'utf8'), secrets).data.toString('utf8');
}

/** Records a hit for each secret in `text`. The hit's file label is redacted. */
function findSecrets(label: string, text: string, secrets: SecretValue[], hits: Map<string, ScanHit>): void {
	for (const { name, value } of secrets) {
		for (const { encoding, text: form } of encodedForms(value)) {
			if (text.includes(toLatin1Needle(form))) {
				const file = redact(label, secrets);
				hits.set(`${file}\0${name}\0${encoding}`, { file, name, encoding });
			}
		}
	}
}

/** Checks a file, directory or zip entry name. */
function scanName(label: string, name: string, secrets: SecretValue[], hits: Map<string, ScanHit>): void {
	findSecrets(label, Buffer.from(name, 'utf8').toString('latin1'), secrets, hits);
}

async function scanData(label: string, data: Buffer, secrets: SecretValue[], hits: Map<string, ScanHit>): Promise<void> {
	if (isZip(label, data)) {
		for (const entry of await readZipEntries(data, label)) {
			const entryLabel = `${label}!${entry.path}`;
			scanName(entryLabel, entry.path, secrets, hits);
			await scanData(entryLabel, entry.data, secrets, hits);
		}
		return;
	}
	const text = data.toString('latin1');
	// The HTML reporter stores its data as a base64 zip inside index.html.
	const embedded = /<template id="playwrightReportBase64">data:application\/zip;base64,(?<data>[A-Za-z0-9+/=\s]*)<\/template>/.exec(text);
	if (embedded?.groups) {
		await scanData(`${label}!embedded.zip`, Buffer.from(embedded.groups.data, 'base64'), secrets, hits);
	}
	findSecrets(label, text, secrets, hits);
}

// upload-artifact follows symlinks, so links are scanned as what they point to.
async function scanPath(path: string, secrets: SecretValue[], hits: Map<string, ScanHit>, visited: Set<string>): Promise<void> {
	let stat;
	try {
		stat = await fs.stat(path);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
			return;
		}
		throw err;
	}
	scanName(path, basename(path), secrets, hits);
	if (stat.isDirectory()) {
		const real = await fs.realpath(path);
		if (visited.has(real)) {
			return;
		}
		visited.add(real);
		for (const child of await fs.readdir(path)) {
			await scanPath(join(path, child), secrets, hits, visited);
		}
	} else if (stat.isFile()) {
		await scanData(path, await fs.readFile(path), secrets, hits);
	}
}

/**
 * Looks for secret values in the contents and names of files and zips (nested too) under
 * `paths`. Reports secret names only, and redacts secrets from file labels and error messages.
 * Missing paths are skipped. Unreadable files or zips throw, so callers fail closed.
 */
export async function scanPaths(paths: string[], secrets: SecretValue[]): Promise<ScanHit[]> {
	const hits = new Map<string, ScanHit>();
	const visited = new Set<string>();
	try {
		for (const path of paths) {
			await scanPath(path, secrets, hits, visited);
		}
	} catch (err) {
		// fs and zip errors quote the path, which can hold a secret.
		throw new Error(redact(err instanceof Error ? err.message : String(err), secrets));
	}
	return [...hits.values()];
}
