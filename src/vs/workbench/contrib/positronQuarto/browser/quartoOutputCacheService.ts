/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
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
	ICellOutputWebviewMetadata,
	ICacheInfo,
	IClearCacheResult,
	DEFAULT_CACHE_CONFIG,
} from '../common/quartoExecutionTypes.js';
import { isQuartoOrRmdFile } from '../common/positronQuartoConfig.js';

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
	source?: string;
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

			// Only handle Quarto/RMarkdown files
			if (!isQuartoOrRmdFile(source.path) && !isQuartoOrRmdFile(target.path)) {
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
					source: cell.source,
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

	saveOutput(documentUri: URI, cellId: string, contentHash: string, label: string | undefined, output: ICellOutput, source?: string): void {
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
			// Before creating a new entry, check for existing entry with same content hash
			// but different cell ID. This happens when a cell moves (e.g., new cell inserted
			// above it), which changes the cell's index and thus its ID, but the content
			// hash remains the same. We need to remove the old entry to prevent duplicate
			// outputs when the cache is reloaded.
			for (const [existingCellId, existingEntry] of entry.cells) {
				if (existingEntry.contentHash === contentHash && existingCellId !== cellId) {
					this._logService.debug('[QuartoOutputCacheService] Cell moved from', existingCellId, 'to', cellId, '- removing old cache entry');
					entry.cells.delete(existingCellId);
					break;
				}
			}

			cellEntry = {
				cellId,
				contentHash,
				label,
				source,
				outputs: [],
			};
			entry.cells.set(cellId, cellEntry);
		}

		// Update source if provided (may arrive with later outputs for the same cell)
		if (source !== undefined) {
			cellEntry.source = source;
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

	findAndTransferFromUntitled(fileUri: URI, contentHashes: string[]): ICachedDocument | undefined {
		if (contentHashes.length === 0) {
			return undefined;
		}

		// Look for an untitled document cache that has matching content hashes
		for (const [key, entry] of this._documentCaches) {
			// Only check untitled documents
			if (!key.startsWith('untitled:')) {
				continue;
			}

			// Check if any cells in this cache match our content hashes
			let matchCount = 0;
			for (const cellEntry of entry.cells.values()) {
				if (contentHashes.includes(cellEntry.contentHash)) {
					matchCount++;
				}
			}

			// If we found matches, this is likely the same document
			// We require at least one match, and ideally all cells should match
			if (matchCount > 0) {
				this._logService.debug('[QuartoOutputCacheService] Found matching untitled cache:',
					key, 'with', matchCount, 'matching cells');

				// Transfer the cache to the new file URI
				const fileKey = fileUri.toString();
				const newEntry: DocumentCacheEntry = {
					sourceUri: fileKey,
					lastUpdated: Date.now(),
					cells: new Map(entry.cells),
				};

				// Update the cell IDs to match the new document's cell structure
				// (cell IDs include index, which might differ)
				// For now, we keep the same cell entries - they'll be matched by content hash

				this._documentCaches.set(fileKey, newEntry);
				this.markDirty(fileUri);

				// Clear the old untitled cache
				this._documentCaches.delete(key);
				this._dirtyDocuments.delete(key);
				const timeout = this._writeTimeouts.get(key);
				if (timeout) {
					clearTimeout(timeout);
					this._writeTimeouts.delete(key);
				}

				// Convert to cached document format
				return this._cacheEntryToCachedDocument(newEntry);
			}
		}

		return undefined;
	}

	async findCacheByContentHash(targetUri: URI, contentHashes: string[]): Promise<ICachedDocument | undefined> {
		if (contentHashes.length === 0) {
			return undefined;
		}

		// First check in-memory caches (faster)
		const inMemoryResult = this.findAndTransferFromUntitled(targetUri, contentHashes);
		if (inMemoryResult) {
			return inMemoryResult;
		}

		// Search on-disk cache files for matching content hashes
		// This handles the case where an untitled document gets a different URI after window reload
		try {
			const exists = await this._fileService.exists(this._cacheDir);
			if (!exists) {
				return undefined;
			}

			const resolved = await this._fileService.resolve(this._cacheDir);
			if (!resolved.children) {
				return undefined;
			}

			for (const child of resolved.children) {
				if (child.isDirectory || !child.name.endsWith('.ipynb')) {
					continue;
				}

				try {
					const content = await this._fileService.readFile(child.resource);
					const ipynb = JSON.parse(content.value.toString());

					if (!this._validateCacheStructure(ipynb)) {
						continue;
					}

					// Check if this cache has matching content hashes
					let matchCount = 0;
					for (const cell of ipynb.cells) {
						if (cell.cell_type === 'code' && cell.metadata?.quarto_content_hash) {
							if (contentHashes.includes(cell.metadata.quarto_content_hash)) {
								matchCount++;
							}
						}
					}

					if (matchCount > 0) {
						this._logService.debug('[QuartoOutputCacheService] Found matching on-disk cache:',
							child.name, 'with', matchCount, 'matching cells');

						// Load the cache and transfer it to the target URI
						const cachedDoc = this._ipynbToCachedDocument(targetUri, ipynb);

						// Populate in-memory cache under the new URI
						const entry: DocumentCacheEntry = {
							sourceUri: targetUri.toString(),
							lastUpdated: cachedDoc.lastUpdated,
							cells: new Map(),
						};

						for (const cell of cachedDoc.cells) {
							entry.cells.set(cell.cellId, {
								cellId: cell.cellId,
								contentHash: cell.contentHash,
								label: cell.label,
								source: cell.source,
								outputs: [...cell.outputs],
							});
						}

						this._documentCaches.set(targetUri.toString(), entry);
						this.markDirty(targetUri);

						// Delete the old cache file (it was for a different URI)
						await this._deleteCacheFile(child.resource);

						return cachedDoc;
					}
				} catch {
					// Skip files that can't be parsed
					continue;
				}
			}
		} catch (error) {
			this._logService.warn('[QuartoOutputCacheService] Error searching cache files:', error);
		}

		return undefined;
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
				source: cellEntry.source
					? cellEntry.source.split('\n').map((line, i, arr) => i < arr.length - 1 ? line + '\n' : line)
					: [],
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
				source: cellEntry.source,
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

			const source = Array.isArray(cell.source) && cell.source.length > 0
				? cell.source.join('')
				: undefined;

			cells.push({
				cellId: cell.metadata?.quarto_cell_id ?? '',
				contentHash: cell.metadata?.quarto_content_hash ?? '',
				label: cell.metadata?.quarto_label,
				source,
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
	 *
	 * IMPORTANT: For rich outputs (execute_result/display_data), we must collect
	 * ALL mime types into the data field, not just the first one. This is critical
	 * for outputs like Plotly that have both application/vnd.plotly.v1+json AND
	 * text/html - the renderer needs access to all representations to choose the
	 * best one for display.
	 */
	private _outputToIpynb(output: ICellOutput): IpynbOutput {
		const items = output.items ?? [];

		// First pass: check for special output types (stream, error)
		// These are mutually exclusive with rich outputs
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
		}

		// Second pass: collect ALL mime types for rich outputs
		// This is critical for outputs like Plotly which have multiple representations
		const data: Record<string, unknown> = {};
		for (const item of items) {
			// Skip internal notebook mime types (already handled above)
			if (item.mime.startsWith('application/vnd.code.notebook.')) {
				continue;
			}
			data[item.mime] = item.data;
		}

		// Preserve webviewMetadata in the ipynb metadata field
		// This is critical for interactive outputs (Plotly, widgets, etc.) that need
		// webview rendering - without this metadata, they fall back to text rendering
		const metadata: Record<string, unknown> = {};
		if (output.webviewMetadata) {
			metadata.quarto_webview_metadata = output.webviewMetadata;
		}

		// Return rich output with all collected mime types
		return {
			output_type: 'execute_result',
			data,
			metadata,
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

		// Restore webviewMetadata from ipynb metadata if present
		// This allows interactive outputs (Plotly, widgets, etc.) to render via webview
		const webviewMetadata = (ipynbOutput.output_type === 'execute_result' || ipynbOutput.output_type === 'display_data')
			? ipynbOutput.metadata?.quarto_webview_metadata as ICellOutputWebviewMetadata | undefined
			: undefined;

		return {
			outputId: generateUuid(),
			items,
			webviewMetadata,
		};
	}

	async getCacheInfo(): Promise<ICacheInfo> {
		let totalSizeBytes = 0;
		let fileCount = 0;

		try {
			const exists = await this._fileService.exists(this._cacheDir);
			if (!exists) {
				return {
					totalSizeBytes: 0,
					fileCount: 0,
					cacheDir: this._cacheDir,
				};
			}

			const resolved = await this._fileService.resolve(this._cacheDir, { resolveMetadata: true });
			if (resolved.children) {
				for (const child of resolved.children) {
					if (!child.isDirectory && child.name.endsWith('.ipynb')) {
						totalSizeBytes += child.size ?? 0;
						fileCount++;
					}
				}
			}
		} catch (error) {
			this._logService.warn('[QuartoOutputCacheService] Failed to get cache info:', error);
		}

		return {
			totalSizeBytes,
			fileCount,
			cacheDir: this._cacheDir,
		};
	}

	getCachePath(documentUri: URI): URI {
		return this._getCachePath(documentUri);
	}

	async clearAllCaches(): Promise<IClearCacheResult> {
		this._logService.debug('[QuartoOutputCacheService] Clearing all caches');

		// Clear all in-memory state
		this._documentCaches.clear();
		this._dirtyDocuments.clear();

		// Clear all pending write timeouts
		for (const timeout of this._writeTimeouts.values()) {
			clearTimeout(timeout);
		}
		this._writeTimeouts.clear();

		// Wait for any in-flight writes to complete
		if (this._pendingWrites.size > 0) {
			await Promise.allSettled(this._pendingWrites.values());
		}
		this._pendingWrites.clear();

		// Delete all cache files
		const errors: string[] = [];
		let filesDeleted = 0;
		let bytesFreed = 0;

		try {
			const exists = await this._fileService.exists(this._cacheDir);
			if (!exists) {
				return {
					success: true,
					filesDeleted: 0,
					bytesFreed: 0,
					errors: [],
				};
			}

			const resolved = await this._fileService.resolve(this._cacheDir, { resolveMetadata: true });
			if (resolved.children) {
				for (const child of resolved.children) {
					if (!child.isDirectory && child.name.endsWith('.ipynb')) {
						try {
							const fileSize = child.size ?? 0;
							await this._fileService.del(child.resource);
							filesDeleted++;
							bytesFreed += fileSize;
						} catch (error) {
							const errorMessage = error instanceof Error ? error.message : String(error);
							errors.push(`Failed to delete ${child.name}: ${errorMessage}`);
							this._logService.warn('[QuartoOutputCacheService] Failed to delete cache file:', child.resource.toString(), error);
						}
					}
				}
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			errors.push(`Failed to enumerate cache files: ${errorMessage}`);
			this._logService.warn('[QuartoOutputCacheService] Failed to enumerate cache directory:', error);
		}

		const success = errors.length === 0;
		this._logService.debug('[QuartoOutputCacheService] Cache clear complete:',
			'deleted', filesDeleted, 'files,',
			'freed', bytesFreed, 'bytes,',
			'errors:', errors.length);

		return {
			success,
			filesDeleted,
			bytesFreed,
			errors,
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
