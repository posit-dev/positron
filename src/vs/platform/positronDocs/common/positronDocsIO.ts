/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The I/O interfaces the docs cache is built against. Deliberately three narrow
 * ones rather than a single wide one, so each test fake stays small and the seam
 * can be re-hosted in a node service later without a rewrite.
 *
 * Paths are plain strings joined with forward slashes. Node's fs accepts
 * forward slashes on Windows, so no platform-specific joining is needed here
 * and `common` stays free of node imports.
 */

export interface IDocsHttpResponse {
	readonly status: number;
	readonly etag?: string;
	/** Absent on 304, on any error status, and on HEAD. */
	readonly body?: Uint8Array;
}

export interface IDocsHttpGetOptions {
	/** Send as `If-None-Match`, so an unchanged alias answers 304. */
	readonly etag?: string;
	/** Abort and reject once the response exceeds this many bytes. */
	readonly maxBytes?: number;
}

export interface IDocsHttpClient {
	get(url: string, options?: IDocsHttpGetOptions): Promise<IDocsHttpResponse>;
	head(url: string): Promise<IDocsHttpResponse>;
}

export interface IDocsFileStore {
	exists(path: string): Promise<boolean>;
	readFile(path: string): Promise<string>;
	writeFile(path: string, data: string | Uint8Array): Promise<void>;
	/** Recursive; succeeds if the directory already exists. */
	mkdir(path: string): Promise<void>;
	rename(from: string, to: string): Promise<void>;
	/** Recursive; succeeds if the path does not exist. */
	delete(path: string): Promise<void>;
	/**
	 * Immediate children, names only. Empty array if the path is missing.
	 * Only meaningful for directories - call `isDirectory` first rather than
	 * inferring file-ness from an empty result, since an empty directory and a
	 * file are indistinguishable here (and a node-backed store throws ENOTDIR
	 * on a file).
	 */
	readdir(path: string): Promise<string[]>;
	/** True for a directory, false for a file and for a missing path. */
	isDirectory(path: string): Promise<boolean>;
	/** Lowercase hex digest of the file's bytes. */
	sha256(path: string): Promise<string>;
}

export interface IDocsArchive {
	/** Entry paths as recorded in the archive, before any extraction. */
	entryNames(zipPath: string): Promise<string[]>;
	extract(zipPath: string, targetPath: string): Promise<void>;
}

/**
 * Narrow logger so the seam does not depend on ILogService. Nothing here is
 * user-actionable, so there is deliberately no error level.
 */
export interface IDocsLogger {
	info(message: string): void;
	warn(message: string): void;
}

/** What `positron.docs.getLocalDocs()` resolves to. */
export interface ILocalDocs {
	readonly path: string;
	readonly schema: number;
	readonly version: string;
	readonly profile: string;
	readonly docsBaseUrl: string;
	readonly isExactMatch: boolean;
}

/** Join path segments with forward slashes, collapsing duplicates. */
export function joinDocsPath(...segments: string[]): string {
	return segments
		.filter(segment => segment.length > 0)
		.map((segment, index) => index === 0 ? segment.replace(/\/+$/, '') : segment.replace(/^\/+|\/+$/g, ''))
		// Filtered again after stripping: an all-slashes segment strips to empty
		// and would otherwise join into a stray trailing or doubled slash.
		.filter((segment, index) => index === 0 || segment.length > 0)
		.join('/');
}
