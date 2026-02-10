/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DEFAULT_FENCE_LENGTH, QUARTO_TO_VSCODE_LANGUAGE } from './quartoNotebookSerializer.js';
import { parseQuarto } from '../../positronQuarto/common/quartoParser.js';
import { QuartoCodeBlock, QuartoNodeType, QuartoRawBlock } from '../../positronQuarto/common/quartoTypes.js';
import { CellKind, ICellDto2 } from '../../notebook/common/notebookCommon.js';

/** Regex to match cell boundary markers with surrounding whitespace */
const CELL_MARKER_REGEX = /\s*<!-- cell -->\s*/;

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

	const doc = parseQuarto(content);
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
		// end.line is 0-based last line, so first line after frontmatter is end.line + 1
		gapStart = frontmatter.location.end.line + 1;
		// Skip blank lines after frontmatter
		while (gapStart < lines.length && lines[gapStart].trim() === '') {
			gapStart++;
		}
	}

	// Step 2: Walk blocks in order, processing gap regions between them
	for (const block of blocks) {
		const blockStartIndex = block.location.begin.line;
		const blockEndIndex = block.location.end.line;

		// Process gap region before this block
		if (gapStart < blockStartIndex) {
			processGapRegion(lines, gapStart, blockStartIndex, cells);
		}

		// Compute fence length from the opening line for round-trip metadata
		const fenceLength = lines[blockStartIndex].match(/^`+/)![0].length;
		const metadata: Record<string, unknown> = {};
		if (fenceLength > DEFAULT_FENCE_LENGTH) {
			metadata.quarto = { fenceLength };
		}
		const cellMetadata = Object.keys(metadata).length > 0 ? metadata : undefined;

		// Convert block to code cell
		if (block.type === QuartoNodeType.CodeBlock) {
			const codeBlock = block as QuartoCodeBlock;
			const vscodeLang = QUARTO_TO_VSCODE_LANGUAGE[codeBlock.language] || codeBlock.language;
			cells.push({
				source: codeBlock.content,
				language: vscodeLang,
				cellKind: CellKind.Code,
				mime: undefined,
				outputs: [],
				metadata: cellMetadata,
			});
		} else {
			const rawBlock = block as QuartoRawBlock;
			cells.push({
				source: rawBlock.content,
				language: rawBlock.format,
				cellKind: CellKind.Code,
				mime: undefined,
				outputs: [],
				metadata: cellMetadata,
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
 * Plain fences (```lang without braces) are non-executable and stay as markdown.
 * Only handles markdown content and <!-- cell --> boundary markers.
 */
function processGapRegion(lines: readonly string[], start: number, end: number, cells: ICellDto2[]): void {
	const markdownLines = lines.slice(start, end);
	flushMarkdown(Array.from(markdownLines), cells);
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
