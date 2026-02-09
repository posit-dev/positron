/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	PLAIN_FENCE_START_REGEX,
	CELL_MARKER_REGEX,
	QUARTO_TO_VSCODE_LANGUAGE,
	DEFAULT_FENCE_LENGTH,
} from '../../positronQuarto/common/quartoConstants.js';
import { parseQuartoDocument, QuartoNodeType, QuartoCodeBlock, QuartoRawBlock } from '../../positronQuarto/common/quartoDocumentParser.js';
import { CellKind, ICellDto2 } from '../../notebook/common/notebookCommon.js';

/**
 * Parse QMD text content into notebook cells.
 * Produces cells compatible with VS Code's NotebookData format.
 *
 * Delegates to parseQuartoDocument() for Quarto code blocks and raw blocks,
 * then handles gap regions (plain fences, markdown, cell markers) in a
 * secondary pass.
 */
export function parseQmdToNotebookCells(content: string): ICellDto2[] {
	if (!content) {
		return [];
	}

	const doc = parseQuartoDocument(content);
	const { blocks, frontmatter, lines } = doc;
	const cells: ICellDto2[] = [];

	// Track where our next gap region starts (0-based line index)
	let gapStart = 0;

	// Step 1: Handle frontmatter
	if (frontmatter) {
		cells.push({
			source: frontmatter.rawContent,
			language: 'yaml',
			cellKind: CellKind.Code,
			mime: undefined,
			outputs: [],
			metadata: { quarto: { type: 'frontmatter' } },
		});
		gapStart = frontmatter.endLine; // endLine is the count of lines, which equals the 0-based index of the first line after
		// Skip blank lines after frontmatter
		while (gapStart < lines.length && lines[gapStart].trim() === '') {
			gapStart++;
		}
	}

	// Step 2: Walk blocks in order, processing gap regions between them
	for (const block of blocks) {
		const blockStartIndex = block.location.begin.line - 1; // Convert 1-based to 0-based
		const blockEndIndex = block.location.end.line - 1;

		// Process gap region before this block
		if (gapStart < blockStartIndex) {
			processGapRegion(lines, gapStart, blockStartIndex, cells);
		}

		// Convert block to code cell
		if (block.type === QuartoNodeType.CodeBlock) {
			const codeBlock = block as QuartoCodeBlock;
			const vscodeLang = QUARTO_TO_VSCODE_LANGUAGE[codeBlock.language] || codeBlock.language;
			const metadata: Record<string, unknown> = {};
			if (block.fenceLength) {
				metadata.quarto = { fenceLength: block.fenceLength };
			}
			cells.push({
				source: codeBlock.content,
				language: vscodeLang,
				cellKind: CellKind.Code,
				mime: undefined,
				outputs: [],
				metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
			});
		} else {
			const rawBlock = block as QuartoRawBlock;
			const metadata: Record<string, unknown> = {};
			if (block.fenceLength) {
				metadata.quarto = { fenceLength: block.fenceLength };
			}
			cells.push({
				source: rawBlock.content,
				language: rawBlock.format,
				cellKind: CellKind.Code,
				mime: undefined,
				outputs: [],
				metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
			});
		}

		// Move past the block (including closing fence)
		gapStart = blockEndIndex + 1;
		// Skip blank lines after blocks
		while (gapStart < lines.length && lines[gapStart].trim() === '') {
			gapStart++;
		}
	}

	// Step 3: Process final gap region after last block
	if (gapStart < lines.length) {
		processGapRegion(lines, gapStart, lines.length, cells);
	}

	return cells;
}

/**
 * Process a "gap" region between AST blocks (or at the start/end of the document).
 * Handles plain fences, markdown content, and cell boundary markers.
 */
function processGapRegion(lines: readonly string[], start: number, end: number, cells: ICellDto2[]): void {
	let pendingMarkdown: string[] = [];
	let i = start;

	while (i < end) {
		const line = lines[i];

		// Check for plain code fence: ``` or ```language (no braces)
		const plainMatch = line.match(PLAIN_FENCE_START_REGEX);
		if (plainMatch) {
			// Flush pending markdown before the plain fence
			flushMarkdown(pendingMarkdown, cells);
			pendingMarkdown = [];

			const fenceLength = plainMatch[1].length;
			const language = plainMatch[2]?.toLowerCase() || 'text';
			const codeLines: string[] = [];
			i++;

			// Collect lines until closing fence
			while (i < end) {
				const codeLine = lines[i];
				if (isClosingFence(codeLine, fenceLength)) {
					break;
				}
				codeLines.push(codeLine);
				i++;
			}

			const metadata: Record<string, unknown> = {};
			if (fenceLength > DEFAULT_FENCE_LENGTH) {
				metadata.quarto = { fenceLength };
			}

			cells.push({
				source: codeLines.join('\n'),
				language: language,
				cellKind: CellKind.Code,
				mime: undefined,
				outputs: [],
				metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
			});

			i++; // Skip past closing fence
			// Skip blank lines after code block
			while (i < end && lines[i].trim() === '') {
				i++;
			}
			continue;
		}

		// Regular line: accumulate as markdown
		pendingMarkdown.push(line);
		i++;
	}

	// Flush remaining markdown
	flushMarkdown(pendingMarkdown, cells);
}

/**
 * Check if a line is a closing fence that matches the opening fence length.
 */
function isClosingFence(line: string, openingLength: number): boolean {
	const match = line.match(/^(`{3,})\s*$/);
	if (!match) {
		return false;
	}
	return match[1].length >= openingLength;
}

/**
 * Flush accumulated markdown lines into one or more markup cells,
 * splitting on <!-- cell --> boundary markers.
 */
function flushMarkdown(markdownLines: string[], cells: ICellDto2[]): void {
	if (markdownLines.length === 0) {
		return;
	}

	const markdownText = markdownLines.join('\n');

	// Trim trailing newlines from the markdown block
	const trimmed = trimTrailingNewlines(markdownText);

	if (trimmed === '') {
		return;
	}

	// Split on cell boundary markers
	const parts = trimmed.split(CELL_MARKER_REGEX);

	for (const part of parts) {
		cells.push({
			source: part,
			language: 'markdown',
			cellKind: CellKind.Markup,
			mime: undefined,
			outputs: [],
		});
	}
}

/**
 * Trim trailing newlines from a string.
 */
function trimTrailingNewlines(s: string): string {
	return s.replace(/\n+$/, '');
}
