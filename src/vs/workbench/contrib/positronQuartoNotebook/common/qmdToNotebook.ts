/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseQuarto } from '../../positronQuarto/common/quartoParser.js';
import { QuartoBlock, QuartoFrontmatter, QuartoNodeType } from '../../positronQuarto/common/quartoTypes.js';
import { CellKind, ICellDto2, NotebookData } from '../../notebook/common/notebookCommon.js';
import { CellMetadataWithQuarto } from './quartoNotebookTypes.js';

/** Regex to match cell boundary markers with surrounding whitespace */
const CELL_MARKER_REGEX = /\s*<!-- cell -->\s*/;

/** Regex to match blank lines */
const WHITESPACE_REGEX = /^\s*$/;

/**
 * Parse QMD text content into notebook cells.
 * Produces cells compatible with VS Code's NotebookData format.
 */
export function qmdToNotebook(content: string): NotebookData {
	const notebook: NotebookData = {
		cells: [],
		metadata: {},
	};
	const { cells } = notebook;

	if (!content) {
		return notebook;
	}

	const doc = parseQuarto(content);
	const { blocks, frontmatter, lines } = doc;

	// Track where the next markdown cell starts
	let markdownStart = 0;

	// Handle frontmatter
	if (frontmatter) {
		cells.push(frontmatterToCell(frontmatter));

		// Move past the frontmatter and skip blank lines
		markdownStart = skipBlankLines(lines, frontmatter.location.end.line + 1);
	}

	// Walk code/raw blocks in order, creating markdown cells between them
	for (const block of blocks) {
		// Process markdown region before this block
		if (markdownStart < block.location.begin.line) {
			cells.push(...createMarkdownCells(lines, markdownStart, block.location.begin.line));
		}

		// Process the block
		cells.push(blockToCell(block));

		// Move past the block (including closing fence) and skip blank lines
		markdownStart = skipBlankLines(lines, block.location.end.line + 1);
	}

	// Process final markdown region
	if (markdownStart < lines.length) {
		cells.push(...createMarkdownCells(lines, markdownStart, lines.length));
	}

	return notebook;
}


/** Convert QuartoFrontmatter to a notebook cell. */
function frontmatterToCell(frontmatter: QuartoFrontmatter): ICellDto2 {
	return {
		source: frontmatter.rawContent,
		language: 'raw',
		cellKind: CellKind.Code,
		mime: undefined,
		outputs: [],
		// Store that it's a frontmatter cell for round-tripping
		metadata: { quarto: { type: 'frontmatter' } } satisfies CellMetadataWithQuarto,
	};
}

/** Convert a QuartoBlock to a notebook cell. */
function blockToCell(block: QuartoBlock): ICellDto2 {
	switch (block.type) {
		case QuartoNodeType.CodeBlock:
			return {
				source: block.content,
				language: block.language,
				cellKind: CellKind.Code,
				mime: undefined,
				outputs: [],
			};
		case QuartoNodeType.RawBlock:
			return {
				source: block.content,
				language: 'raw',
				cellKind: CellKind.Code,
				mime: undefined,
				outputs: [],
			};
	}
}

/** Advance a line index past any blank lines. */
function skipBlankLines(lines: readonly string[], index: number): number {
	while (index < lines.length && WHITESPACE_REGEX.test(lines[index])) {
		index++;
	}
	return index;
}

/**
 * Flush accumulated markdown lines into one or more markup cells,
 * splitting on <!-- cell --> boundary markers.
 */
function createMarkdownCells(lines: readonly string[], start: number, end: number): ICellDto2[] {
	if (end <= start) {
		return [];
	}

	const markdownLines = lines.slice(start, end);
	const markdownText = markdownLines.join('\n');

	// Trim trailing newlines from the markdown block
	const trimmed = trimTrailingNewlines(markdownText);

	if (trimmed === '') {
		return [];
	}

	// Split on cell boundary markers
	const parts = trimmed.split(CELL_MARKER_REGEX);

	const cells: ICellDto2[] = [];
	for (const part of parts) {
		cells.push({
			source: part,
			language: 'markdown',
			cellKind: CellKind.Markup,
			mime: undefined,
			outputs: [],
		});
	}
	return cells;
}

/**
 * Trim trailing newlines from a string.
 */
function trimTrailingNewlines(s: string): string {
	return s.replace(/\n+$/, '');
}
