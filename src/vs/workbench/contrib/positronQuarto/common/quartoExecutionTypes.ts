/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { Event } from '../../../../base/common/event.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { QuartoCodeCell } from './quartoTypes.js';
import { Range } from '../../../../editor/common/core/range.js';
import { ILanguageRuntimeCodeExecutedEvent } from '../../../services/positronConsole/common/positronConsoleCodeExecution.js';

// Service decorators
export const IQuartoOutputCacheService = createDecorator<IQuartoOutputCacheService>('quartoOutputCacheService');

export const IQuartoExecutionManager = createDecorator<IQuartoExecutionManager>('quartoExecutionManager');

/**
 * State of a cell's execution.
 */
export enum CellExecutionState {
	/** Cell is not executing */
	Idle = 'idle',
	/** Cell is queued for execution */
	Queued = 'queued',
	/** Cell is currently running */
	Running = 'running',
	/** Cell execution completed successfully */
	Completed = 'completed',
	/** Cell execution failed */
	Error = 'error',
}

/**
 * Information about a cell execution.
 */
export interface CellExecution {
	/** ID of the cell being executed */
	readonly cellId: string;
	/** Current execution state */
	readonly state: CellExecutionState;
	/** Unique ID for this execution instance */
	readonly executionId: string;
	/** Timestamp when execution started (ms since epoch) */
	readonly startTime?: number;
	/** Timestamp when execution ended (ms since epoch) */
	readonly endTime?: number;
	/** Document URI for this execution */
	readonly documentUri: URI;
}

/**
 * Output item from cell execution.
 * Simplified representation of notebook cell output.
 */
export interface ICellOutputItem {
	/** MIME type of the output */
	readonly mime: string;
	/** Output data as base64 string or text */
	readonly data: string;
}

/**
 * Type of webview rendering needed for an output.
 */
export type WebviewOutputType = 'widget' | 'display' | 'preload' | null;

/**
 * Metadata for outputs that may require webview rendering.
 * Contains the original runtime message data for complex output types.
 */
export interface ICellOutputWebviewMetadata {
	/** The type of webview rendering needed */
	readonly webviewType: WebviewOutputType;
	/** The raw data object from the runtime message (MIME type -> data mapping) */
	readonly rawData: Record<string, unknown>;
	/** Resource roots from the runtime message, if any */
	readonly resourceRoots?: string[];
}

/**
 * A cell output containing one or more output items.
 */
export interface ICellOutput {
	/** Unique ID for this output */
	readonly outputId: string;
	/** The output items */
	readonly items: ICellOutputItem[];
	/** Optional metadata for webview rendering */
	readonly webviewMetadata?: ICellOutputWebviewMetadata;
}

/**
 * Event emitted when execution state changes.
 */
export interface ExecutionStateChangeEvent {
	/** The cell execution info */
	readonly execution: CellExecution;
	/** Previous state */
	readonly previousState: CellExecutionState;
}

/**
 * Event emitted when output is received.
 */
export interface ExecutionOutputEvent {
	/** ID of the cell that produced the output */
	readonly cellId: string;
	/** The output */
	readonly output: ICellOutput;
	/** Document URI */
	readonly documentUri: URI;
}

/**
 * Configuration for execution behavior.
 */
export interface IQuartoExecutionConfig {
	/** Timeout for individual cell execution in milliseconds. 0 = no timeout. Default: 300000 (5 min) */
	readonly executionTimeout: number;
	/** Maximum output size in bytes before truncation. Default: 10MB */
	readonly maxOutputSize: number;
	/** Maximum number of output items per cell. Default: 100 */
	readonly maxOutputItems: number;
}

/**
 * Default execution configuration values.
 */
export const DEFAULT_EXECUTION_CONFIG: IQuartoExecutionConfig = {
	executionTimeout: 300000, // 5 minutes
	maxOutputSize: 10 * 1024 * 1024, // 10MB
	maxOutputItems: 100,
};

/**
 * Interface for the Quarto execution manager service.
 */
export interface IQuartoExecutionManager {
	readonly _serviceBrand: undefined;

	/**
	 * Event fired when execution state changes.
	 */
	readonly onDidChangeExecutionState: Event<ExecutionStateChangeEvent>;

	/**
	 * Event fired when output is received from execution.
	 */
	readonly onDidReceiveOutput: Event<ExecutionOutputEvent>;

	/**
	 * Execute a single cell.
	 * @param documentUri URI of the document
	 * @param cell Cell to execute
	 * @param token Optional cancellation token
	 */
	executeCell(documentUri: URI, cell: QuartoCodeCell, token?: CancellationToken): Promise<void>;

	/**
	 * Execute multiple cells sequentially.
	 * @param documentUri URI of the document
	 * @param cells Cells to execute in order
	 * @param token Optional cancellation token
	 */
	executeCells(documentUri: URI, cells: QuartoCodeCell[], token?: CancellationToken): Promise<void>;

	/**
	 * Execute a set of cells, identified by their ranges.
	 *
	 * @param documentUri URI of the document
	 * @param cellRanges Ranges of the cells to execute
	 * @param token Optional cancellation token
	 */
	executeCellRanges(documentUri: URI, cellRanges: Range[], token?: CancellationToken): Promise<void>;

	/**
	 * Cancel execution for a document.
	 * @param documentUri URI of the document
	 * @param cellId Optional specific cell ID to cancel. If not provided, cancels all.
	 */
	cancelExecution(documentUri: URI, cellId?: string): Promise<void>;

	/**
	 * Get the current execution state for a cell.
	 * @param cellId Cell ID
	 */
	getExecutionState(cellId: string): CellExecutionState;

	/**
	 * Get IDs of cells currently queued for execution.
	 * @param documentUri URI of the document
	 */
	getQueuedCells(documentUri: URI): string[];

	/**
	 * Get the currently running cell for a document.
	 * @param documentUri URI of the document
	 */
	getRunningCell(documentUri: URI): string | undefined;

	/**
	 * Clear all execution state for a document.
	 * @param documentUri URI of the document
	 */
	clearExecutionState(documentUri: URI): void;

	/**
	 * Event that fires when the manager executes code
	 */
	onDidExecuteCode: Event<ILanguageRuntimeCodeExecutedEvent>;

}

// ============================================================================
// Output Cache Types
// ============================================================================

/**
 * Cached output for a single cell.
 */
export interface ICachedCellOutput {
	/** Cell ID from the document model */
	readonly cellId: string;
	/** Hash of cell content for validation */
	readonly contentHash: string;
	/** Cell label if present */
	readonly label?: string;
	/** Stored outputs */
	readonly outputs: ICellOutput[];
}

/**
 * Cached document containing cell outputs.
 */
export interface ICachedDocument {
	/** Original qmd file URI */
	readonly sourceUri: string;
	/** Timestamp of last update (ms since epoch) */
	readonly lastUpdated: number;
	/** Cells with outputs */
	readonly cells: ICachedCellOutput[];
}

/**
 * Cache configuration values.
 */
export interface IQuartoCacheConfig {
	/** Maximum cache size in bytes. Default: 500MB */
	readonly maxCacheSize: number;
	/** Debounce delay for cache writes in ms. Default: 1000 */
	readonly writeDebounceMs: number;
}

/**
 * Default cache configuration.
 */
export const DEFAULT_CACHE_CONFIG: IQuartoCacheConfig = {
	maxCacheSize: 500 * 1024 * 1024, // 500 MB
	writeDebounceMs: 1000,
};

/**
 * Service for persisting and loading Quarto cell outputs.
 * Outputs are stored as ipynb files in global storage for cross-workspace persistence.
 */
export interface IQuartoOutputCacheService {
	readonly _serviceBrand: undefined;

	/**
	 * Load cached outputs for a document.
	 * Returns undefined if no cache exists or cache is invalid.
	 */
	loadCache(documentUri: URI): Promise<ICachedDocument | undefined>;

	/**
	 * Save output for a cell. Marks the document as dirty for debounced write.
	 */
	saveOutput(documentUri: URI, cellId: string, contentHash: string, label: string | undefined, output: ICellOutput): void;

	/**
	 * Clear outputs for a cell in the cache.
	 */
	clearCellOutputs(documentUri: URI, cellId: string): void;

	/**
	 * Mark document as needing cache update.
	 */
	markDirty(documentUri: URI): void;

	/**
	 * Force immediate cache write for a document.
	 */
	flushCache(documentUri: URI): Promise<void>;

	/**
	 * Flush all pending caches (for shutdown).
	 */
	flushAll(): Promise<void>;

	/**
	 * Clear cache for a document.
	 */
	clearCache(documentUri: URI): Promise<void>;

	/**
	 * Run cache cleanup (LRU eviction and age-based cleanup).
	 */
	runCleanup(): Promise<void>;

	/**
	 * Get all cached outputs for a document.
	 * Returns outputs from in-memory cache if available, otherwise from disk.
	 */
	getCachedOutputs(documentUri: URI): Map<string, ICellOutput[]>;

	/**
	 * Find and transfer cache from an untitled document to a file document.
	 * This is used when an untitled document is saved to a file - the cache
	 * needs to be transferred to the new file URI.
	 *
	 * @param fileUri The file URI to transfer cache to
	 * @param contentHashes Content hashes of cells in the file
	 * @returns The transferred cached document, or undefined if no match found
	 */
	findAndTransferFromUntitled(fileUri: URI, contentHashes: string[]): ICachedDocument | undefined;

	/**
	 * Find cache by content hash, searching both in-memory and on-disk caches.
	 * This is used when a document (especially untitled) can't find its cache
	 * by direct URI lookup - the document may have a different URI after window
	 * reload but the content hashes will still match.
	 *
	 * @param targetUri The URI to bind the found cache to
	 * @param contentHashes Content hashes of cells in the document
	 * @returns The matched cached document, or undefined if no match found
	 */
	findCacheByContentHash(targetUri: URI, contentHashes: string[]): Promise<ICachedDocument | undefined>;
}
