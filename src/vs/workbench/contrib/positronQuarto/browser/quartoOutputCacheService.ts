/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { StringSHA1 } from '../../../../base/common/hash.js';
import { IFileService, FileOperationResult, toFileOperationResult } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ILifecycleService } from '../../../services/lifecycle/common/lifecycle.js';
import { IUserDataProfilesService } from '../../../../platform/userDataProfile/common/userDataProfile.js';
import { IWorkingCopyFileService, SourceTargetPair } from '../../../services/workingCopy/common/workingCopyFileService.js';
import {
	IQuartoOutputCacheService,
	ICachedDocument,
	ICachedCellOutput,
	ICellOutput,
	ICellOutputItem,
	DEFAULT_CACHE_CONFIG,
} from '../common/quartoExecutionTypes.js';

// Cache directory name within global storage
const CACHE_DIR_NAME = 'quarto-inline-outputs';

// Cache file format version
const CACHE_VERSION = 1;

/**
 * ipynb format cell structure for cache files.
 */
interface IpynbCell {
	cell_type: 'code';
	execution_count: null;
	metadata: {
		quarto_cell_id: string;
		quarto_content_hash: string;
		quarto_label?: string;
	};
	source: string[];
	outputs: IpynbOutput[];
}

/**
 * ipynb format output types.
 */
interface IpynbStreamOutput {
	output_type: 'stream';
	name: 'stdout' | 'stderr';
	text: string[];
}

interface IpynbErrorOutput {
	output_type: 'error';
	ename: string;
	evalue: string;
	traceback: string[];
}

interface IpynbExecuteResultOutput {
	output_type: 'execute_result' | 'display_data';
	data: Record<string, unknown>;
	metadata: Record<string, unknown>;
}

type IpynbOutput = IpynbStreamOutput | IpynbErrorOutput | IpynbExecuteResultOutput;

/**
 * ipynb format notebook structure.
 */
interface IpynbNotebook {
	nbformat: number;
	nbformat_minor: number;
	metadata: {
		quarto_source: string;
		quarto_cache_version: number;
		last_updated: number;
	};
	cells: IpynbCell[];
}

/**
 * In-memory cache entry for a document.
 */
interface DocumentCacheEntry {
	sourceUri: string;
	lastUpdated: number;
	cells: Map<string, CellCacheEntry>;
}

/**
 * In-memory cache entry for a cell.
 */
interface CellCacheEntry {
	cellId: string;
	contentHash: string;
	label?: string;
	outputs: ICellOutput[];
}

/**
 * Service for persisting and loading Quarto cell outputs.
 * Uses ipynb format stored in global storage for cross-workspace persistence.
 */
export class QuartoOutputCacheService extends Disposable implements IQuartoOutputCacheService {
	declare readonly _serviceBrand: undefined;

	private readonly _cacheDir: URI;
	private readonly _documentCaches = new Map<string, DocumentCacheEntry>();
	private readonly _dirtyDocuments = new Set<string>();
	private readonly _pendingWrites = new Map<string, Promise<void>>();
	private readonly _writeTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

	constructor(
		@IFileService private readonly _fileService: IFileService,
		@ILogService private readonly _logService: ILogService,
		@ILifecycleService private readonly _lifecycleService: ILifecycleService,
		@IUserDataProfilesService private readonly _userDataProfilesService: IUserDataProfilesService,
		@IWorkingCopyFileService private readonly _workingCopyFileService: IWorkingCopyFileService,
	) {
		super();

		// Cache directory in global storage (cross-workspace)
		this._cacheDir = URI.joinPath(
			this._userDataProfilesService.defaultProfile.globalStorageHome,
			CACHE_DIR_NAME
		);

		this._logService.debug('[QuartoOutputCacheService] Cache directory:', this._cacheDir.toString());

		// Flush all caches on shutdown
		this._register(this._lifecycleService.onWillShutdown(e => {
			e.join(this.flushAll(), { id: 'join.quartoOutputCache', label: 'Saving Quarto output cache' });
		}));

		// Handle file rename/move events
		this._register(this._workingCopyFileService.onDidRunWorkingCopyFileOperation(e => {
			if (e.operation === 2 /* FileOperation.MOVE */) {
				this._handleFileRename(e.files);
			}
		}));
	}

	/**
	 * Handle file rename/move by updating cache mappings.
	 */
	private async _handleFileRename(files: readonly SourceTargetPair[]): Promise<void> {
		for (const { source, target } of files) {
			// source is optional in SourceTargetPair but should be present for MOVE operations
			if (!source) {
				continue;
			}

			// Only handle .qmd files
			if (!source.path.endsWith('.qmd') && !target.path.endsWith('.qmd')) {
				continue;
			}

			const oldKey = source.toString();
			const entry = this._documentCaches.get(oldKey);

			if (entry) {
				// Update in-memory cache entry
				const newKey = target.toString();
				entry.sourceUri = newKey;
				this._documentCaches.delete(oldKey);
				this._documentCaches.set(newKey, entry);

				// Update dirty tracking
				if (this._dirtyDocuments.has(oldKey)) {
					this._dirtyDocuments.delete(oldKey);
					this._dirtyDocuments.add(newKey);
				}

				// Delete old cache file and write to new location
				const oldCachePath = this._getCachePath(source);
				await this._deleteCacheFile(oldCachePath);

				// Mark new location as dirty to trigger write
				this.markDirty(target);

				this._logService.debug('[QuartoOutputCacheService] Moved cache from', source.toString(), 'to', target.toString());
			}
		}
	}

	/**
	 * Computes the cache file path for a document.
	 * Uses SHA-1 hash of the document URI for the filename.
	 */
	private _getCachePath(documentUri: URI): URI {
		const hash = this._hashUri(documentUri);
		return URI.joinPath(this._cacheDir, `${hash}.ipynb`);
	}

	/**
	 * Computes a hash of the document URI for cache filename.
	 */
	private _hashUri(uri: URI): string {
		const sha = new StringSHA1();
		sha.update(uri.toString());
		return sha.digest().substring(0, 16);
	}

	/**
	 * Validates the structure of a cached ipynb notebook.
	 */
	private _validateCacheStructure(ipynb: unknown): ipynb is IpynbNotebook {
		if (typeof ipynb !== 'object' || ipynb === null) {
			return false;
		}
		const obj = ipynb as Record<string, unknown>;
		return (
			typeof obj.nbformat === 'number' &&
			Array.isArray(obj.cells) &&
			typeof obj.metadata === 'object' &&
			obj.metadata !== null &&
			typeof (obj.metadata as Record<string, unknown>).quarto_cache_version === 'number'
		);
	}

	async loadCache(documentUri: URI): Promise<ICachedDocument | undefined> {
		const key = documentUri.toString();
		const cachePath = this._getCachePath(documentUri);

		// First check if we already have the document in the in-memory cache.
		// This handles the case where the file is closed and reopened before the
		// debounced disk write completes - the in-memory cache will have the data.
		const existingEntry = this._documentCaches.get(key);
		if (existingEntry && existingEntry.cells.size > 0) {
			this._logService.debug('[QuartoOutputCacheService] Using in-memory cache for', documentUri.toString());
			return this._cacheEntryToCachedDocument(existingEntry);
		}

		try {
			const exists = await this._fileService.exists(cachePath);
			if (!exists) {
				this._logService.debug('[QuartoOutputCacheService] No cache file found for', documentUri.toString());
				return undefined;
			}

			const content = await this._fileService.readFile(cachePath);
			const ipynb = JSON.parse(content.value.toString());

			// Validate structure
			if (!this._validateCacheStructure(ipynb)) {
				this._logService.warn('[QuartoOutputCacheService] Invalid cache structure, deleting:', cachePath.toString());
				await this._deleteCacheFile(cachePath);
				return undefined;
			}

			// Check version
			if (ipynb.metadata.quarto_cache_version !== CACHE_VERSION) {
				this._logService.warn('[QuartoOutputCacheService] Cache version mismatch, deleting:', cachePath.toString());
				await this._deleteCacheFile(cachePath);
				return undefined;
			}

			const cachedDoc = this._ipynbToCachedDocument(documentUri, ipynb);

			// Populate in-memory cache
			const entry: DocumentCacheEntry = {
				sourceUri: documentUri.toString(),
				lastUpdated: cachedDoc.lastUpdated,
				cells: new Map(),
			};

			for (const cell of cachedDoc.cells) {
				entry.cells.set(cell.cellId, {
					cellId: cell.cellId,
					contentHash: cell.contentHash,
					label: cell.label,
					outputs: [...cell.outputs],
				});
			}

			this._documentCaches.set(key, entry);

			this._logService.debug('[QuartoOutputCacheService] Loaded cache with', cachedDoc.cells.length, 'cells for', documentUri.toString());
			return cachedDoc;

		} catch (error) {
			this._logService.warn('[QuartoOutputCacheService] Failed to load cache:', error);

			// Delete corrupted cache file
			try {
				await this._deleteCacheFile(cachePath);
			} catch { /* ignore */ }

			return undefined;
		}
	}

	saveOutput(documentUri: URI, cellId: string, contentHash: string, label: string | undefined, output: ICellOutput): void {
		const key = documentUri.toString();

		// Get or create document cache entry
		let entry = this._documentCaches.get(key);
		if (!entry) {
			entry = {
				sourceUri: documentUri.toString(),
				lastUpdated: Date.now(),
				cells: new Map(),
			};
			this._documentCaches.set(key, entry);
		}

		// Get or create cell cache entry
		let cellEntry = entry.cells.get(cellId);
		if (!cellEntry) {
			cellEntry = {
				cellId,
				contentHash,
				label,
				outputs: [],
			};
			entry.cells.set(cellId, cellEntry);
		}

		// Add output
		cellEntry.outputs.push(output);
		entry.lastUpdated = Date.now();

		// Mark dirty and schedule write
		this.markDirty(documentUri);

		this._logService.debug('[QuartoOutputCacheService] Saved output for cell', cellId, 'in', documentUri.toString());
	}

	clearCellOutputs(documentUri: URI, cellId: string): void {
		const key = documentUri.toString();
		const entry = this._documentCaches.get(key);

		if (entry) {
			entry.cells.delete(cellId);
			entry.lastUpdated = Date.now();
			this.markDirty(documentUri);
		}
	}

	markDirty(documentUri: URI): void {
		const key = documentUri.toString();
		this._dirtyDocuments.add(key);

		// Clear existing timeout
		const existingTimeout = this._writeTimeouts.get(key);
		if (existingTimeout) {
			clearTimeout(existingTimeout);
		}

		// Set debounced write
		const timeout = setTimeout(() => {
			this._writeTimeouts.delete(key);
			this._writeCache(documentUri);
		}, DEFAULT_CACHE_CONFIG.writeDebounceMs);

		this._writeTimeouts.set(key, timeout);
	}

	async flushCache(documentUri: URI): Promise<void> {
		const key = documentUri.toString();

		// Clear timeout if pending
		const timeout = this._writeTimeouts.get(key);
		if (timeout) {
			clearTimeout(timeout);
			this._writeTimeouts.delete(key);
		}

		// Wait for any in-flight write
		const pending = this._pendingWrites.get(key);
		if (pending) {
			await pending;
		}

		// Write if dirty
		if (this._dirtyDocuments.has(key)) {
			await this._writeCache(documentUri);
		}
	}

	async flushAll(): Promise<void> {
		this._logService.debug('[QuartoOutputCacheService] Flushing all caches');

		// Clear all timeouts
		for (const timeout of this._writeTimeouts.values()) {
			clearTimeout(timeout);
		}
		this._writeTimeouts.clear();

		// Write all dirty documents
		const writePromises: Promise<void>[] = [];
		for (const key of this._dirtyDocuments) {
			writePromises.push(this._writeCache(URI.parse(key)));
		}

		await Promise.allSettled(writePromises);

		this._logService.debug('[QuartoOutputCacheService] Flush complete');
	}

	async clearCache(documentUri: URI): Promise<void> {
		const key = documentUri.toString();

		// Clear in-memory cache
		this._documentCaches.delete(key);
		this._dirtyDocuments.delete(key);

		// Clear any pending write
		const timeout = this._writeTimeouts.get(key);
		if (timeout) {
			clearTimeout(timeout);
			this._writeTimeouts.delete(key);
		}

		// Delete cache file
		const cachePath = this._getCachePath(documentUri);
		await this._deleteCacheFile(cachePath);

		this._logService.debug('[QuartoOutputCacheService] Cleared cache for', documentUri.toString());
	}

	async runCleanup(): Promise<void> {
		this._logService.debug('[QuartoOutputCacheService] Running cache cleanup');

		try {
			// Ensure cache directory exists
			const exists = await this._fileService.exists(this._cacheDir);
			if (!exists) {
				return;
			}

			// Resolve directory with children and metadata
			const resolved = await this._fileService.resolve(this._cacheDir, { resolveMetadata: true });
			if (!resolved.children) {
				return;
			}

			// Filter to .ipynb files and collect stats
			const fileStats: Array<{ name: string; uri: URI; mtime: number; size: number }> = [];

			for (const child of resolved.children) {
				if (!child.isDirectory && child.name.endsWith('.ipynb')) {
					fileStats.push({
						name: child.name,
						uri: child.resource,
						mtime: child.mtime ?? 0,
						size: child.size ?? 0,
					});
				}
			}

			// Sort by modification time (oldest first)
			fileStats.sort((a, b) => a.mtime - b.mtime);

			// Delete old files (age-based cleanup)
			const cutoffTime = Date.now() - (DEFAULT_CACHE_CONFIG.maxCacheAgeDays * 24 * 60 * 60 * 1000);
			let totalSize = fileStats.reduce((sum, f) => sum + f.size, 0);
			let deletedCount = 0;

			for (const file of fileStats) {
				// Delete if too old
				if (file.mtime < cutoffTime) {
					await this._deleteCacheFile(file.uri);
					totalSize -= file.size;
					deletedCount++;
					continue;
				}

				// Delete if over size limit (LRU - oldest files deleted first)
				if (totalSize > DEFAULT_CACHE_CONFIG.maxCacheSize) {
					await this._deleteCacheFile(file.uri);
					totalSize -= file.size;
					deletedCount++;
				}
			}

			if (deletedCount > 0) {
				this._logService.debug('[QuartoOutputCacheService] Deleted', deletedCount, 'old cache files');
			}

		} catch (error) {
			this._logService.warn('[QuartoOutputCacheService] Cache cleanup failed:', error);
		}
	}

	getCachedOutputs(documentUri: URI): Map<string, ICellOutput[]> {
		const key = documentUri.toString();
		const entry = this._documentCaches.get(key);
		const result = new Map<string, ICellOutput[]>();

		if (entry) {
			for (const [cellId, cellEntry] of entry.cells) {
				result.set(cellId, [...cellEntry.outputs]);
			}
		}

		return result;
	}

	/**
	 * Internal method to write cache to disk.
	 */
	private async _writeCache(documentUri: URI): Promise<void> {
		const key = documentUri.toString();

		// Queue write to prevent concurrent writes
		const writePromise = this._performWrite(documentUri);
		this._pendingWrites.set(key, writePromise);

		try {
			await writePromise;
			this._dirtyDocuments.delete(key);
		} finally {
			this._pendingWrites.delete(key);
		}
	}

	/**
	 * Perform the actual write operation.
	 */
	private async _performWrite(documentUri: URI): Promise<void> {
		const key = documentUri.toString();
		const entry = this._documentCaches.get(key);
		const cachePath = this._getCachePath(documentUri);

		if (!entry || entry.cells.size === 0) {
			// No outputs to cache, delete cache file if exists
			await this._deleteCacheFile(cachePath);
			return;
		}

		// Convert to ipynb format
		const ipynb = this._cacheEntryToIpynb(entry);

		// Ensure directory exists
		try {
			await this._fileService.createFolder(this._cacheDir);
		} catch { /* ignore if already exists */ }

		// Write file
		await this._fileService.writeFile(
			cachePath,
			VSBuffer.fromString(JSON.stringify(ipynb, null, 2))
		);

		this._logService.debug('[QuartoOutputCacheService] Wrote cache for', documentUri.toString());
	}

	/**
	 * Delete a cache file, ignoring if not found.
	 */
	private async _deleteCacheFile(cachePath: URI): Promise<void> {
		try {
			await this._fileService.del(cachePath);
		} catch (e) {
			if (toFileOperationResult(e) !== FileOperationResult.FILE_NOT_FOUND) {
				throw e;
			}
		}
	}

	/**
	 * Convert in-memory cache entry to ipynb format.
	 */
	private _cacheEntryToIpynb(entry: DocumentCacheEntry): IpynbNotebook {
		const cells: IpynbCell[] = [];

		for (const cellEntry of entry.cells.values()) {
			const outputs = cellEntry.outputs.map(o => this._outputToIpynb(o));

			cells.push({
				cell_type: 'code',
				execution_count: null,
				metadata: {
					quarto_cell_id: cellEntry.cellId,
					quarto_content_hash: cellEntry.contentHash,
					quarto_label: cellEntry.label,
				},
				source: [], // We don't store source in cache
				outputs,
			});
		}

		return {
			nbformat: 4,
			nbformat_minor: 5,
			metadata: {
				quarto_source: entry.sourceUri,
				quarto_cache_version: CACHE_VERSION,
				last_updated: entry.lastUpdated,
			},
			cells,
		};
	}

	/**
	 * Convert in-memory cache entry to ICachedDocument format.
	 */
	private _cacheEntryToCachedDocument(entry: DocumentCacheEntry): ICachedDocument {
		const cells: ICachedCellOutput[] = [];

		for (const cellEntry of entry.cells.values()) {
			cells.push({
				cellId: cellEntry.cellId,
				contentHash: cellEntry.contentHash,
				label: cellEntry.label,
				outputs: [...cellEntry.outputs],
			});
		}

		return {
			sourceUri: entry.sourceUri,
			lastUpdated: entry.lastUpdated,
			cells,
		};
	}

	/**
	 * Convert ipynb notebook to cached document.
	 */
	private _ipynbToCachedDocument(documentUri: URI, ipynb: IpynbNotebook): ICachedDocument {
		const cells: ICachedCellOutput[] = [];

		for (const cell of ipynb.cells) {
			if (cell.cell_type !== 'code') {
				continue;
			}

			const outputs = cell.outputs.map(o => this._ipynbToOutput(o));

			cells.push({
				cellId: cell.metadata?.quarto_cell_id ?? '',
				contentHash: cell.metadata?.quarto_content_hash ?? '',
				label: cell.metadata?.quarto_label,
				outputs,
			});
		}

		return {
			sourceUri: documentUri.toString(),
			lastUpdated: ipynb.metadata?.last_updated ?? Date.now(),
			cells,
		};
	}

	/**
	 * Convert internal output format to ipynb format.
	 */
	private _outputToIpynb(output: ICellOutput): IpynbOutput {
		const items = output.items ?? [];

		for (const item of items) {
			if (item.mime === 'application/vnd.code.notebook.stdout') {
				return {
					output_type: 'stream',
					name: 'stdout',
					text: [item.data],
				};
			}
			if (item.mime === 'application/vnd.code.notebook.stderr') {
				return {
					output_type: 'stream',
					name: 'stderr',
					text: [item.data],
				};
			}
			if (item.mime === 'application/vnd.code.notebook.error') {
				try {
					const error = JSON.parse(item.data);
					return {
						output_type: 'error',
						ename: error.name ?? 'Error',
						evalue: error.message ?? '',
						traceback: error.stack?.split('\n') ?? [],
					};
				} catch {
					return {
						output_type: 'error',
						ename: 'Error',
						evalue: item.data,
						traceback: [],
					};
				}
			}

			// Rich output (images, HTML, etc.)
			return {
				output_type: 'execute_result',
				data: { [item.mime]: item.data },
				metadata: {},
			};
		}

		// Empty output
		return {
			output_type: 'execute_result',
			data: {},
			metadata: {},
		};
	}

	/**
	 * Convert ipynb output format to internal format.
	 */
	private _ipynbToOutput(ipynbOutput: IpynbOutput): ICellOutput {
		const items: ICellOutputItem[] = [];

		switch (ipynbOutput.output_type) {
			case 'stream':
				items.push({
					mime: ipynbOutput.name === 'stderr'
						? 'application/vnd.code.notebook.stderr'
						: 'application/vnd.code.notebook.stdout',
					data: Array.isArray(ipynbOutput.text)
						? ipynbOutput.text.join('')
						: ipynbOutput.text,
				});
				break;

			case 'error':
				items.push({
					mime: 'application/vnd.code.notebook.error',
					data: JSON.stringify({
						name: ipynbOutput.ename,
						message: ipynbOutput.evalue,
						stack: ipynbOutput.traceback?.join('\n'),
					}),
				});
				break;

			case 'execute_result':
			case 'display_data':
				for (const [mime, data] of Object.entries(ipynbOutput.data ?? {})) {
					items.push({
						mime,
						data: typeof data === 'string' ? data : JSON.stringify(data),
					});
				}
				break;
		}

		return {
			outputId: generateUuid(),
			items,
		};
	}

	override dispose(): void {
		// Clear all timeouts
		for (const timeout of this._writeTimeouts.values()) {
			clearTimeout(timeout);
		}
		this._writeTimeouts.clear();

		super.dispose();
	}
}
