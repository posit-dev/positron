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
import { IQuartoDocumentModel, QuartoCodeCell, QuartoCellChangeEvent } from '../common/quartoTypes.js';

// Regular expressions for parsing Quarto documents
const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---/;
const CHUNK_START_REGEX = /^```\{(\w+)([^}]*)\}\s*$/;
const CHUNK_END_REGEX = /^```\s*$/;

/**
 * Maps common Jupyter kernel names to language identifiers.
 */
function kernelToLanguageId(kernelName: string): string | undefined {
	const kernelLower = kernelName.toLowerCase();
	if (kernelLower.includes('python')) {
		return 'python';
	}
	if (kernelLower.includes('ir') || kernelLower === 'r') {
		return 'r';
	}
	if (kernelLower.includes('julia')) {
		return 'julia';
	}
	return undefined;
}

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
 * Simple YAML frontmatter parser.
 * Extracts jupyter kernel specification from frontmatter.
 */
function parseFrontmatter(frontmatterContent: string): { jupyterKernel?: string } {
	const result: { jupyterKernel?: string } = {};

	// Look for jupyter: kernel_name or jupyter:\n  kernelspec:\n    name: kernel_name
	const lines = frontmatterContent.split(/\r?\n/);

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Check for simple form: jupyter: python3
		const simpleMatch = line.match(/^jupyter:\s*(\S+)\s*$/);
		if (simpleMatch) {
			result.jupyterKernel = simpleMatch[1];
			break;
		}

		// Check for complex form: jupyter:
		if (/^jupyter:\s*$/.test(line)) {
			// Look for kernelspec in subsequent lines
			for (let j = i + 1; j < lines.length; j++) {
				const subLine = lines[j];
				// If we hit a non-indented line, stop searching
				if (subLine.match(/^\S/)) {
					break;
				}
				// Look for kernelspec:
				if (/^\s+kernelspec:\s*$/.test(subLine)) {
					// Look for name in subsequent lines
					for (let k = j + 1; k < lines.length; k++) {
						const kernelLine = lines[k];
						// If we hit a line with less indentation, stop
						if (kernelLine.match(/^\s{0,3}\S/)) {
							break;
						}
						const nameMatch = kernelLine.match(/^\s+name:\s*(\S+)/);
						if (nameMatch) {
							result.jupyterKernel = nameMatch[1];
							break;
						}
					}
					break;
				}
			}
			break;
		}
	}

	return result;
}

/**
 * Extracts the cell label from chunk options.
 * The label is the first option if it doesn't contain '='.
 */
function extractLabel(options: string): string | undefined {
	if (!options) {
		return undefined;
	}
	const firstOption = options.split(',')[0].trim();
	if (firstOption && !firstOption.includes('=')) {
		return firstOption;
	}
	return undefined;
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
 * Mutable builder type for constructing QuartoCodeCell objects.
 */
interface MutableQuartoCodeCell {
	id: string;
	language: string;
	label?: string;
	startLine: number;
	endLine: number;
	codeStartLine: number;
	codeEndLine: number;
	options: string;
	contentHash: string;
	index: number;
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
		const lines = content.split(/\r?\n/);
		const cells: QuartoCodeCell[] = [];
		let primaryLanguage: string | undefined;
		let jupyterKernel: string | undefined;

		// Parse frontmatter
		const frontmatterMatch = content.match(FRONTMATTER_REGEX);
		if (frontmatterMatch) {
			try {
				const parsed = parseFrontmatter(frontmatterMatch[1]);
				jupyterKernel = parsed.jupyterKernel;
				if (jupyterKernel) {
					primaryLanguage = kernelToLanguageId(jupyterKernel);
				}
			} catch (e) {
				this._logService.warn('Failed to parse Quarto frontmatter', e);
			}
		}

		// Parse code cells
		let currentCell: Partial<MutableQuartoCodeCell> | null = null;
		let cellIndex = 0;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const lineNum = i + 1; // 1-based line numbers

			if (!currentCell) {
				const startMatch = line.match(CHUNK_START_REGEX);
				if (startMatch) {
					currentCell = {
						language: startMatch[1].toLowerCase(),
						options: startMatch[2].trim(),
						startLine: lineNum,
						codeStartLine: lineNum + 1,
						index: cellIndex,
					};
				}
			} else if (CHUNK_END_REGEX.test(line)) {
				currentCell.endLine = lineNum;
				currentCell.codeEndLine = lineNum - 1;
				currentCell.label = extractLabel(currentCell.options!);

				// Handle empty cells (where codeEndLine < codeStartLine)
				let codeContent = '';
				if (currentCell.codeEndLine! >= currentCell.codeStartLine!) {
					const codeLines = lines.slice(
						currentCell.codeStartLine! - 1,
						currentCell.codeEndLine
					);
					codeContent = codeLines.join('\n');
				}
				currentCell.contentHash = computeContentHash(codeContent);

				// Generate stable ID
				currentCell.id = generateCellId(
					currentCell.index!,
					currentCell.contentHash,
					currentCell.label
				);

				cells.push(currentCell as QuartoCodeCell);
				currentCell = null;
				cellIndex++;
			}
		}

		// Set primary language from first code cell if not from frontmatter
		if (!primaryLanguage && cells.length > 0) {
			primaryLanguage = cells[0].language;
		}

		return { cells, primaryLanguage, jupyterKernel };
	}
}
