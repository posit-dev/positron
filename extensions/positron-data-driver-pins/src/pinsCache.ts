/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { readdir, rmdir, stat, unlink } from 'fs/promises';
import { basename, join } from 'path';

/** The subdirectory of the extension's global storage that holds downloaded pin data files. */
const CACHE_DIR_NAME = 'pins-cache';

/** Pin data files not touched in this many days are removed by {@link PinsCache.prune}. */
const CACHE_MAX_AGE_DAYS = 30;

/**
 * Reduces a server-supplied id (guid, bundle id) to a single safe path segment. Everything outside a
 * conservative charset -- including `/`, `\`, and `.` -- is replaced, so a crafted value from a
 * malicious or compromised server (e.g. `../../etc`) cannot act as a path separator or dot-segment
 * and escape the cache directory. Real ids (UUIDs, integers) pass through unchanged. An all-stripped
 * value falls back to a placeholder so the segment is never empty.
 */
function safeSegment(value: string): string {
	return value.replace(/[^A-Za-z0-9_-]/g, '_') || '_';
}

/**
 * Reduces a server-supplied file name to a safe leaf. `basename` strips any directory components, and
 * the dot-segment / empty cases (which `basename` leaves as `.`/`..`/`''`, all traversal risks) fall
 * back to a fixed name. The real extension is preserved, so legitimate names like `data.parquet` are
 * kept intact.
 */
function safeFileName(filename: string): string {
	const name = basename(filename);
	return name === '' || name === '.' || name === '..' ? 'data' : name;
}

/**
 * An extension-local cache of downloaded pin data files, laid out under the extension's global
 * storage directory as `<globalStorage>/pins-cache/<serverHash>/<guid>/<bundleId>/<file>`.
 *
 * This is deliberately the driver's own cache, not a shared cache with the pins R or Python
 * packages: those two do not share a cache with each other (different root directories, board-dir
 * hashes, and internal layouts), so no single directory could serve both, and reimplementing either
 * package's exact scheme in TypeScript would be fragile across pins releases. The pins hygiene rules
 * that are useful regardless of location are kept: an immutable-skip on download (a bundle is
 * content-addressed by its version, so a present file is never re-fetched) and a prune of files
 * unused for ~30 days.
 */
export class PinsCache {
	/**
	 * @param _baseDir The extension's global storage path (the fsPath of `globalStorageUri`).
	 */
	constructor(private readonly _baseDir: string) { }

	/**
	 * Returns the absolute path a pin version's data file is (or would be) cached at. The server URL is
	 * hashed to keep the path short and to separate servers. Every server-supplied segment (guid,
	 * bundle id, file name) is sanitized so none can act as a path separator or dot-segment and escape
	 * the cache directory, even if the server is malicious or compromised.
	 *
	 * @param serverUrl The normalized Connect server URL.
	 * @param guid The pin's content GUID.
	 * @param bundleId The bundle (version) id.
	 * @param filename The data file name within the bundle.
	 */
	filePath(serverUrl: string, guid: string, bundleId: string, filename: string): string {
		const serverHash = createHash('sha256').update(serverUrl).digest('hex').slice(0, 16);
		return join(this._baseDir, CACHE_DIR_NAME, serverHash, safeSegment(guid), safeSegment(bundleId), safeFileName(filename));
	}

	/** Whether a file is already present at `path` (the immutable-skip check). */
	has(path: string): boolean {
		return existsSync(path);
	}

	/**
	 * Best-effort removal of cached files not modified in the last {@link CACHE_MAX_AGE_DAYS} days,
	 * plus any directories left empty by the removals. Errors are swallowed: cache hygiene must never
	 * fail a connection. Intended to run once when a connection opens, so it never removes a file
	 * downloaded during the current session.
	 */
	async prune(): Promise<void> {
		const cutoff = Date.now() - CACHE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
		await this._pruneDir(join(this._baseDir, CACHE_DIR_NAME), cutoff);
	}

	// Recursively removes stale files under `dir`, then removes `dir`'s now-empty subdirectories.
	private async _pruneDir(dir: string, cutoff: number): Promise<void> {
		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			// The directory doesn't exist yet (nothing cached) or is unreadable: nothing to prune.
			return;
		}
		for (const entry of entries) {
			const full = join(dir, entry.name);
			try {
				if (entry.isDirectory()) {
					await this._pruneDir(full, cutoff);
					// Remove the directory if pruning emptied it.
					if ((await readdir(full)).length === 0) {
						await rmdir(full);
					}
				} else if ((await stat(full)).mtimeMs < cutoff) {
					await unlink(full);
				}
			} catch {
				// Skip anything we can't stat or remove.
			}
		}
	}
}
