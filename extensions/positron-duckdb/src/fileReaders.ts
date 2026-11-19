/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/** A DuckDB extension table function that reads a file format. */
export interface FileReader {
	/** The repository to install the extension from. */
	repo: 'community' | 'core';
	/** The DuckDB extension name. */
	extension: string;
	/** The table function that reads the file. */
	fn: string;
}

// Values are interpolated into SQL, so only identifiers are accepted.
const READER_PATTERN = /^(?:(core|community)\/)?([a-z0-9_]+)(?::([a-z0-9_]+))?$/;

/**
 * Parses a `dataExplorer.fileReaders` value, `[repo/]extension[:function]`.
 * @returns The reader, or undefined if the value is not valid.
 */
export function parseFileReader(value: unknown): FileReader | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}
	const match = READER_PATTERN.exec(value);
	if (!match) {
		return undefined;
	}
	const [, repo, extension, fn] = match;
	return {
		repo: repo === 'core' ? 'core' : 'community',
		extension,
		fn: fn ?? extension,
	};
}

/**
 * Finds the reader for a file extension in the `dataExplorer.fileReaders` setting.
 * @param readers The setting value.
 * @param fileExt The file extension, with or without the leading dot.
 * @returns The reader, or undefined if there is no valid reader for the extension.
 */
export function findFileReader(readers: unknown, fileExt: string): FileReader | undefined {
	if (!readers || typeof readers !== 'object') {
		return undefined;
	}
	const key = fileExt.replace(/^\./, '').toLowerCase();
	if (!Object.prototype.hasOwnProperty.call(readers, key)) {
		return undefined;
	}
	return parseFileReader((readers as Record<string, unknown>)[key]);
}
