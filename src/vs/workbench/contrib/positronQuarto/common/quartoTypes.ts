/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';

/**
 * Represents a code cell in a Quarto document.
 */
export interface QuartoCodeCell {
	/**
	 * Stable identifier: composite of index, content hash prefix, and label.
	 * Format: "{index}-{hashPrefix}-{label|unlabeled}"
	 * Examples: "0-a1b2c3d4-setup", "1-e5f6g7h8-unlabeled"
	 */
	readonly id: string;

	/**
	 * Language of the code cell (python, r, julia, etc.).
	 */
	readonly language: string;

	/**
	 * Optional cell label from chunk options.
	 * This is typically the first option in the chunk header if it doesn't contain '='.
	 */
	readonly label?: string;

	/**
	 * Line number of opening fence (1-based).
	 */
	readonly startLine: number;

	/**
	 * Line number of closing fence (1-based).
	 */
	readonly endLine: number;

	/**
	 * First line of code content (1-based).
	 * This is the line after the opening fence.
	 */
	readonly codeStartLine: number;

	/**
	 * Last line of code content (1-based).
	 * This is the line before the closing fence.
	 */
	readonly codeEndLine: number;

	/**
	 * Raw chunk options string from the opening fence.
	 * This is everything after the language identifier in the chunk header.
	 */
	readonly options: string;

	/**
	 * SHA-256 hash of cell content (first 16 chars).
	 * Used for cache matching and cell identification across edits.
	 */
	readonly contentHash: string;

	/**
	 * Cell index in document (0-based).
	 */
	readonly index: number;
}

/**
 * Event emitted when cells in a Quarto document change.
 */
export interface QuartoCellChangeEvent {
	/**
	 * Cells that were added to the document.
	 */
	readonly added: QuartoCodeCell[];

	/**
	 * IDs of cells that were removed from the document.
	 */
	readonly removed: string[];

	/**
	 * Cells whose content changed.
	 * Map from old cell ID to the new cell object.
	 */
	readonly modified: Map<string, QuartoCodeCell>;
}

/**
 * Interface for a Quarto document model.
 * Provides parsed representation of code cells and frontmatter metadata.
 */
export interface IQuartoDocumentModel extends IDisposable {
	/**
	 * URI of the document.
	 */
	readonly uri: URI;

	/**
	 * Primary language from frontmatter or first code cell.
	 */
	readonly primaryLanguage: string | undefined;

	/**
	 * Jupyter kernel from frontmatter, if specified.
	 */
	readonly jupyterKernel: string | undefined;

	/**
	 * All code cells in the document.
	 */
	readonly cells: readonly QuartoCodeCell[];

	/**
	 * Fired when cells change (add/remove/modify).
	 */
	readonly onDidChangeCells: Event<QuartoCellChangeEvent>;

	/**
	 * Fired when primary language changes.
	 */
	readonly onDidChangeLanguage: Event<string | undefined>;

	/**
	 * Get cell by ID.
	 */
	getCellById(id: string): QuartoCodeCell | undefined;

	/**
	 * Get cell at line number (1-based).
	 */
	getCellAtLine(lineNumber: number): QuartoCodeCell | undefined;

	/**
	 * Get cell by index (0-based).
	 */
	getCellByIndex(index: number): QuartoCodeCell | undefined;

	/**
	 * Find cell by content hash (for cache matching).
	 */
	findCellByContentHash(hash: string): QuartoCodeCell | undefined;

	/**
	 * Get code content for a cell.
	 */
	getCellCode(cell: QuartoCodeCell): string;
}
