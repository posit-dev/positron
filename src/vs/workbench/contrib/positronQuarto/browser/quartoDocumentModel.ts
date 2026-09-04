/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Barrier } from '../../../../base/common/async.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, IDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { StringSHA1 } from '../../../../base/common/hash.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IQuartoDocumentModel, QuartoCodeCell, QuartoCellChangeEvent, QuartoNodeType } from '../common/quartoTypes.js';
import { kernelToLanguageId, parseQuarto } from '../common/quartoParser.js';
import { hasRuntimeProvider } from '../common/quartoLanguages.js';
import { IRuntimeStartupService } from '../../../services/runtimeStartup/common/runtimeStartupService.js';

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
	jupyterKernel: string | undefined;
}

/**
 * Implementation of the Quarto document model.
 * Provides parsed representation of code cells and frontmatter metadata.
 */
export class QuartoDocumentModel extends Disposable implements IQuartoDocumentModel {
	private _cells: QuartoCodeCell[] = [];
	private _reportedLanguage: string | undefined;
	private _jupyterKernel: string | undefined;
	private _cellsById = new Map<string, QuartoCodeCell>();
	private _parseTimeout: ReturnType<typeof setTimeout> | undefined;

	// Open while `_cells` reflects the document's current content.
	private _parsedBarrier = new Barrier();

	private readonly _onDidChangeCells = this._register(new Emitter<QuartoCellChangeEvent>());
	readonly onDidChangeCells: Event<QuartoCellChangeEvent> = this._onDidChangeCells.event;

	private readonly _onDidParse = this._register(new Emitter<void>());
	readonly onDidParse: Event<void> = this._onDidParse.event;

	private readonly _onDidChangeLanguage = this._register(new Emitter<string | undefined>());
	readonly onDidChangeLanguage: Event<string | undefined> = this._onDidChangeLanguage.event;

	constructor(
		private readonly _textModel: ITextModel,
		private readonly _logService: ILogService,
		private readonly _runtimeStartupService: IRuntimeStartupService,
	) {
		super();

		// Initial parse
		this._parseDocument();

		// Listen for changes with debouncing
		this._register(this._textModel.onDidChangeContent(() => {
			this._markUnparsed();
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
		return this._derivePrimaryLanguage();
	}

	get jupyterKernel(): string | undefined {
		return this._jupyterKernel;
	}

	get cells(): readonly QuartoCodeCell[] {
		return this._cells;
	}

	get isParsed(): boolean {
		// The constructor parses the initial content synchronously, so cells are
		// unknown only while a debounced re-parse of changed content is pending.
		return this._parsedBarrier.isOpen();
	}

	async whenParsed(): Promise<void> {
		await this._parsedBarrier.wait();
	}

	synchronize(): void {
		if (!this._parseTimeout) {
			return;
		}
		clearTimeout(this._parseTimeout);
		this._parseTimeout = undefined;
		this._parseDocument();
	}

	/**
	 * Closes the parse gate so `whenParsed` callers wait for the pending re-parse.
	 * A `Barrier` can't be re-closed, hence the replacement -- but only when open,
	 * since replacing a closed one strands the callers already waiting on it.
	 */
	private _markUnparsed(): void {
		if (this._parsedBarrier.isOpen()) {
			this._parsedBarrier = new Barrier();
		}
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

	findCellByContentHash(hash: string, preferIndex?: number): QuartoCodeCell | undefined {
		const matches = this._cells.filter(cell => cell.contentHash === hash);
		if (matches.length === 0) {
			return undefined;
		}
		// When multiple cells have the same content hash (e.g., duplicate cells in
		// teaching materials), prefer the one at the expected index if provided.
		if (preferIndex !== undefined) {
			const indexMatch = matches.find(cell => cell.index === preferIndex);
			if (indexMatch) {
				return indexMatch;
			}
		}
		return matches[0];
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

		this._jupyterKernel = parsed.jupyterKernel;

		const primaryLanguage = this._derivePrimaryLanguage();
		if (primaryLanguage !== this._reportedLanguage) {
			this._reportedLanguage = primaryLanguage;
			this._onDidChangeLanguage.fire(primaryLanguage);
		}

		this._parsedBarrier.open();

		// Always fire onDidParse after re-parsing, even if cells didn't change.
		// This allows listeners to update positions based on fresh cell line numbers.
		this._onDidParse.fire();
	}

	private _parse(content: string): ParsedDocument {
		const doc = parseQuarto(content, this._logService);

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

		return { cells, jupyterKernel: doc.frontmatter?.jupyterKernel };
	}

	/**
	 * The primary language comes from the frontmatter kernel, falling back to the
	 * fence language of the first cell whose language has runtimes. A custom
	 * Jupyter kernelspec name (e.g. `spectral-comparison-3.14`) can't be mapped
	 * to a known language, so the cell fence language is used as a fallback
	 * rather than leaving the primary language undefined (which would disable the
	 * kernel picker and Run Cell). Languages with no runtimes, such as mermaid
	 * diagrams, can't host a kernel; a document made only of those has no primary
	 * language.
	 *
	 * Derived on read, since the providers are known only once extensions have
	 * been scanned, which can happen after the document is first parsed.
	 */
	private _derivePrimaryLanguage(): string | undefined {
		return (this._jupyterKernel ? kernelToLanguageId(this._jupyterKernel) : undefined)
			?? this._cells.find(
				cell => hasRuntimeProvider(cell.language, this._runtimeStartupService))?.language;
	}
}
