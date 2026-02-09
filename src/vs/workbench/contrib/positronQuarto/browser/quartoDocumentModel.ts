/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, IDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { StringSHA1 } from '../../../../base/common/hash.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IQuartoDocumentModel, QuartoCodeCell, QuartoCellChangeEvent, QuartoNodeType } from '../common/quartoTypes.js';
import { kernelToLanguageId } from '../common/quartoConstants.js';
import { parseQuartoDocument } from '../common/quartoDocumentParser.js';

/**
 * Computes a SHA-1 hash of the content, truncated to 16 characters.
 * This is used for cell identification and cache matching.
 */
function computeContentHash(content: string): string {
	const sha = new StringSHA1();
	sha.update(content);
	return sha.digest().substring(0, 16);
}

/**
 * Generates a stable cell ID from index, content hash, and label.
 * Format: "{index}-{hashPrefix}-{label|unlabeled}"
 */
function generateCellId(
	index: number,
	contentHash: string,
	label: string | undefined
): string {
	const hashPrefix = contentHash.substring(0, 8);
	const labelPart = label || 'unlabeled';
	return `${index}-${hashPrefix}-${labelPart}`;
}


/**
 * Represents the parsed state of a Quarto document.
 */
interface ParsedDocument {
	cells: QuartoCodeCell[];
	primaryLanguage: string | undefined;
	jupyterKernel: string | undefined;
}

/**
 * Implementation of the Quarto document model.
 * Provides parsed representation of code cells and frontmatter metadata.
 */
export class QuartoDocumentModel extends Disposable implements IQuartoDocumentModel {
	private _cells: QuartoCodeCell[] = [];
	private _primaryLanguage: string | undefined;
	private _jupyterKernel: string | undefined;
	private _cellsById = new Map<string, QuartoCodeCell>();
	private _parseTimeout: ReturnType<typeof setTimeout> | undefined;

	private readonly _onDidChangeCells = this._register(new Emitter<QuartoCellChangeEvent>());
	readonly onDidChangeCells: Event<QuartoCellChangeEvent> = this._onDidChangeCells.event;

	private readonly _onDidParse = this._register(new Emitter<void>());
	readonly onDidParse: Event<void> = this._onDidParse.event;

	private readonly _onDidChangeLanguage = this._register(new Emitter<string | undefined>());
	readonly onDidChangeLanguage: Event<string | undefined> = this._onDidChangeLanguage.event;

	constructor(
		private readonly _textModel: ITextModel,
		private readonly _logService: ILogService,
	) {
		super();

		// Initial parse
		this._parseDocument();

		// Listen for changes with debouncing
		this._register(this._textModel.onDidChangeContent(() => {
			if (this._parseTimeout) {
				clearTimeout(this._parseTimeout);
			}
			this._parseTimeout = setTimeout(() => {
				this._parseTimeout = undefined;
				this._parseDocument();
			}, 100); // 100ms debounce
		}));

		this._register({
			dispose: () => {
				if (this._parseTimeout) {
					clearTimeout(this._parseTimeout);
					this._parseTimeout = undefined;
				}
			}
		} satisfies IDisposable);
	}

	get uri(): URI {
		return this._textModel.uri;
	}

	get primaryLanguage(): string | undefined {
		return this._primaryLanguage;
	}

	get jupyterKernel(): string | undefined {
		return this._jupyterKernel;
	}

	get cells(): readonly QuartoCodeCell[] {
		return this._cells;
	}

	getCellById(id: string): QuartoCodeCell | undefined {
		return this._cellsById.get(id);
	}

	getCellAtLine(lineNumber: number): QuartoCodeCell | undefined {
		return this._cells.find(cell =>
			lineNumber >= cell.startLine && lineNumber <= cell.endLine
		);
	}

	getCellByIndex(index: number): QuartoCodeCell | undefined {
		return this._cells[index];
	}

	findCellByContentHash(hash: string): QuartoCodeCell | undefined {
		return this._cells.find(cell => cell.contentHash === hash);
	}

	getCellCode(cell: QuartoCodeCell): string {
		const lines: string[] = [];
		for (let i = cell.codeStartLine; i <= cell.codeEndLine; i++) {
			lines.push(this._textModel.getLineContent(i));
		}
		return lines.join('\n');
	}

	private _parseDocument(): void {
		const content = this._textModel.getValue();
		const oldCells = this._cells;

		// Parse new state
		const parsed = this._parse(content);

		// Build change event
		const added: QuartoCodeCell[] = [];
		const removed: string[] = [];
		const modified = new Map<string, QuartoCodeCell>();

		// Create a map of old cells by content hash for efficient lookup
		const oldCellsByHash = new Map<string, QuartoCodeCell>();
		for (const cell of oldCells) {
			oldCellsByHash.set(cell.contentHash, cell);
		}

		// Create a map of new cells by content hash
		const newCellsByHash = new Map<string, QuartoCodeCell>();
		for (const cell of parsed.cells) {
			newCellsByHash.set(cell.contentHash, cell);
		}

		// Find removed and modified cells
		for (const oldCell of oldCells) {
			const newCellByHash = newCellsByHash.get(oldCell.contentHash);
			if (!newCellByHash) {
				// Cell content changed - check if it was modified (same label, different content)
				const byLabel = oldCell.label
					? parsed.cells.find(c => c.label === oldCell.label)
					: undefined;
				if (byLabel) {
					modified.set(oldCell.id, byLabel);
				} else {
					removed.push(oldCell.id);
				}
			}
		}

		// Find added cells
		for (const newCell of parsed.cells) {
			const oldCellByHash = oldCellsByHash.get(newCell.contentHash);
			if (!oldCellByHash) {
				// Check if this cell is not already tracked as a modification
				let isModified = false;
				for (const modifiedCell of modified.values()) {
					if (modifiedCell.id === newCell.id) {
						isModified = true;
						break;
					}
				}
				if (!isModified) {
					added.push(newCell);
				}
			}
		}

		// Update state
		this._cells = parsed.cells;
		this._cellsById = new Map(parsed.cells.map(c => [c.id, c]));

		// Fire events
		if (added.length > 0 || removed.length > 0 || modified.size > 0) {
			this._onDidChangeCells.fire({ added, removed, modified });
		}

		if (parsed.primaryLanguage !== this._primaryLanguage) {
			this._primaryLanguage = parsed.primaryLanguage;
			this._onDidChangeLanguage.fire(parsed.primaryLanguage);
		}

		this._jupyterKernel = parsed.jupyterKernel;

		// Always fire onDidParse after re-parsing, even if cells didn't change.
		// This allows listeners to update positions based on fresh cell line numbers.
		this._onDidParse.fire();
	}

	private _parse(content: string): ParsedDocument {
		const doc = parseQuartoDocument(content, this._logService);

		// Convert code blocks to cells
		const cells: QuartoCodeCell[] = [];
		let cellIndex = 0;

		for (const block of doc.blocks) {
			if (block.type !== QuartoNodeType.CodeBlock) {
				continue;
			}
			const startLine = block.location.begin.line + 1;	// Convert 0-based to 1-based
			const endLine = block.location.end.line + 1;		// Convert 0-based to 1-based
			const contentHash = computeContentHash(block.content);

			cells.push({
				id: generateCellId(cellIndex, contentHash, block.label),
				language: block.language,
				label: block.label,
				startLine,
				endLine,
				codeStartLine: startLine + 1,
				codeEndLine: endLine - 1,
				options: block.options,
				contentHash,
				index: cellIndex,
			});
			cellIndex++;
		}

		// Determine primary language from frontmatter or first cell
		const jupyterKernel = doc.frontmatter?.jupyterKernel;
		const primaryLanguage = jupyterKernel ?
			kernelToLanguageId(jupyterKernel) :
			cells.at(0)?.language;

		return { cells, primaryLanguage, jupyterKernel };
	}
}
