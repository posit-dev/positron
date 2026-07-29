/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DOCS_INDEX_FILENAME, DOCS_MANIFEST_FILENAME, IDocsBundleManifest, parseManifest } from './positronDocsBundle.js';
import { IDocsFileStore, joinDocsPath } from './positronDocsPorts.js';

export type DocsValidationFailure =
	| 'missing-manifest'
	| 'missing-index'
	| 'bad-manifest'
	| 'file-count-mismatch';

export type DocsValidationResult =
	| { readonly ok: true; readonly manifest: IDocsBundleManifest }
	| { readonly ok: false; readonly reason: DocsValidationFailure };

/**
 * Reject archive entries that could write outside the extraction target.
 *
 * base/node/zip.ts does some of this, but the archive arrives over the network,
 * so we assert it ourselves rather than trusting it. Returns the first
 * offending entry, or undefined when every entry is safe.
 */
export function guardEntryNames(names: readonly string[]): string | undefined {
	for (const name of names) {
		if (name.includes('\u0000')) {
			return name;
		}
		// Normalise Windows separators before reasoning about segments.
		const normalized = name.replace(/\\/g, '/');
		if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
			return name;
		}
		let depth = 0;
		for (const segment of normalized.split('/')) {
			if (segment === '' || segment === '.') {
				continue;
			}
			depth += segment === '..' ? -1 : 1;
			if (depth < 0) {
				return name;
			}
		}
	}
	return undefined;
}

/**
 * Check an extracted bundle before it is swapped into place.
 *
 * Deliberately structural and cheap: bundle.json parses at a schema we
 * understand, llms.txt is present, and the extracted file count matches what
 * the manifest declared. A corrupted byte inside a Markdown page degrades one
 * assistant answer rather than compromising anything, so byte-level integrity
 * is the digest's job at download time, not this function's.
 */
export async function validateExtractedBundle(files: IDocsFileStore, dir: string): Promise<DocsValidationResult> {
	const manifestPath = joinDocsPath(dir, DOCS_MANIFEST_FILENAME);
	if (!await files.exists(manifestPath)) {
		return { ok: false, reason: 'missing-manifest' };
	}
	if (!await files.exists(joinDocsPath(dir, DOCS_INDEX_FILENAME))) {
		return { ok: false, reason: 'missing-index' };
	}

	const manifest = parseManifest(await files.readFile(manifestPath));
	if (!manifest) {
		return { ok: false, reason: 'bad-manifest' };
	}

	const actual = await countFiles(files, dir);
	if (actual !== manifest.fileCount) {
		return { ok: false, reason: 'file-count-mismatch' };
	}
	return { ok: true, manifest };
}

async function countFiles(files: IDocsFileStore, dir: string): Promise<number> {
	let count = 0;
	for (const name of await files.readdir(dir)) {
		const child = joinDocsPath(dir, name);
		// Ask the store what the child is rather than inferring it from an empty
		// readdir. An empty directory would otherwise count as one file - and
		// real extractors do create them, from explicit directory entries in the
		// archive - producing a spurious file-count-mismatch.
		if (await files.isDirectory(child)) {
			count += await countFiles(files, child);
		} else {
			count += 1;
		}
	}
	return count;
}
