/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { TextDecoder, TextEncoder } from 'util';
import { QmdDocument, Block, CodeBlock, RawBlock, SourceInfo } from './ast/index.js';
import * as ast from './ast/index.js';

/** Marker comment to separate consecutive markdown cells */
const CELL_BOUNDARY_MARKER = '<!-- cell -->';

const QUARTO_LANGUAGE_MAP: Record<string, string> = {
	'python': 'python',
	// TODO: better way to handle braces
	'{python}': 'python',
	'py': 'python',
	'{py}': 'python',
	'r': 'r',
	'{r}': 'r',
	'julia': 'julia',
	'jl': 'julia',
	'{julia}': 'julia',
	'{jl}': 'julia',
	'ojs': 'javascript',
	'{ojs}': 'javascript',
	'mermaid': 'mermaid',
	'{mermaid}': 'mermaid',
	'dot': 'dot',
	'{dot}': 'dot',
};

/**
 * Context needed for conversion, including original source for text extraction.
 */
interface ConversionContext {
	sourceText: string;
	sourceBytes: Uint8Array;
	sourceInfoPool: SourceInfo[];
}

/**
 * Result of frontmatter extraction.
 */
interface FrontmatterResult {
	/** The frontmatter text including --- delimiters */
	text: string;
	/** End byte offset (exclusive) of the frontmatter block */
	endOffset: number;
}

/**
 * Extract YAML frontmatter from a QMD document as raw text.
 * Scans the document directly for `---` delimiters at the start.
 */
function extractFrontmatter(
	doc: QmdDocument,
	sourceBytes: Uint8Array
): FrontmatterResult | null {
	// Check if document has frontmatter metadata
	if (!doc.meta || Object.keys(doc.meta).length === 0) {
		return null;
	}

	const len = sourceBytes.length;

	// Document must start with `---` followed by newline
	if (len < 4 ||
		sourceBytes[0] !== 0x2D || // -
		sourceBytes[1] !== 0x2D || // -
		sourceBytes[2] !== 0x2D) { // -
		return null;
	}

	// Check for newline after opening `---`
	let pos = 3;
	if (sourceBytes[pos] === 0x0D) { // \r
		pos++;
	}
	if (pos >= len || sourceBytes[pos] !== 0x0A) { // \n
		return null;
	}
	pos++; // Move past the newline

	// Scan for closing `---` at line start
	while (pos < len - 2) {
		// Look for newline followed by `---`
		if (sourceBytes[pos] === 0x0A) { // \n
			if (pos + 3 < len &&
				sourceBytes[pos + 1] === 0x2D &&
				sourceBytes[pos + 2] === 0x2D &&
				sourceBytes[pos + 3] === 0x2D) {
				// Found closing delimiter
				let endOffset = pos + 4;
				// Skip past trailing newline(s)
				if (endOffset < len && sourceBytes[endOffset] === 0x0D) {
					endOffset++;
				}
				if (endOffset < len && sourceBytes[endOffset] === 0x0A) {
					endOffset++;
				}

				// Extract frontmatter text
				const decoder = new TextDecoder();
				const text = decoder.decode(sourceBytes.slice(0, endOffset)).trim();

				return { text, endOffset };
			}
		}
		pos++;
	}

	return null;
}

/**
 * Convert a QmdDocument to VS Code NotebookData.
 * @param doc The parsed QMD document from the WASM parser.
 * @param sourceText The original source text for source location extraction.
 * @returns A NotebookData object suitable for VS Code's notebook API.
 */
export function convertToNotebookData(
	doc: QmdDocument,
	sourceText: string
): vscode.NotebookData {
	const encoder = new TextEncoder();
	const context: ConversionContext = {
		sourceText,
		sourceBytes: encoder.encode(sourceText),
		sourceInfoPool: doc.astContext.sourceInfoPool,
	};

	const cells: vscode.NotebookCellData[] = [];

	// Extract frontmatter as first cell (if present)
	const frontmatter = extractFrontmatter(doc, context.sourceBytes);
	if (frontmatter) {
		const cell = new vscode.NotebookCellData(
			vscode.NotebookCellKind.Code,
			frontmatter.text, // Includes --- delimiters
			'yaml'
		);
		cell.metadata = { qmdCellType: 'frontmatter' };
		cells.push(cell);
	}

	// Convert remaining blocks to cells, skipping content before frontmatter end
	const contentCells = convertBlocksToCells(
		doc.blocks,
		context,
		frontmatter?.endOffset
	);
	cells.push(...contentCells);

	const notebookData = new vscode.NotebookData(cells);
	notebookData.metadata = {
		pandocApiVersion: doc['pandoc-api-version'],
	};

	return notebookData;
}

function convertBlocksToCells(
	blocks: Block[],
	context: ConversionContext,
	minStartOffset?: number
): vscode.NotebookCellData[] {
	const cells: vscode.NotebookCellData[] = [];
	let pendingMarkdownBlocks: Block[] = [];

	const flushMarkdownBlocks = (maxEndOffset?: number) => {
		if (pendingMarkdownBlocks.length > 0) {
			// createMarkdownCells handles splitting at <!-- cell --> markers
			cells.push(...createMarkdownCells(pendingMarkdownBlocks, context, minStartOffset, maxEndOffset));
			pendingMarkdownBlocks = [];
		}
	};

	for (const block of blocks) {
		if (block.t === 'CodeBlock') {
			// Flush pending markdown, capping at the start of this code block
			flushMarkdownBlocks(ast.startOffset(block));
			cells.push(createCodeCell(block, context));
		} else if (block.t === 'RawBlock') {
			// Flush pending markdown, capping at the start of this code block
			flushMarkdownBlocks(ast.startOffset(block));
			cells.push(createRawBlockCell(block));
		} else {
			// Accumulate markdown blocks
			pendingMarkdownBlocks.push(block);
		}
	}

	// Flush remaining markdown
	flushMarkdownBlocks();

	return cells;
}

function createCodeCell(block: CodeBlock, context: ConversionContext): vscode.NotebookCellData {
	const code = ast.content(block);
	const rawLanguage = ast.language(block) ?? '';
	const language = QUARTO_LANGUAGE_MAP[rawLanguage.toLowerCase()] || rawLanguage || 'text';

	const cell = new vscode.NotebookCellData(
		vscode.NotebookCellKind.Code,
		code,
		language
	);

	// Store raw fence info for round-trip (e.g., "{python #fig-plot label='My Plot'}")
	const fenceInfo = extractFenceInfo(block, context);
	if (fenceInfo) {
		cell.metadata = { qmdFenceInfo: fenceInfo };
	}

	return cell;
}

/**
 * Extract the raw fence info string from a code block (e.g., "{python #id .class}").
 * This preserves exact formatting for round-trip serialization.
 */
function extractFenceInfo(block: CodeBlock, context: ConversionContext): string | undefined {
	const startOffset = ast.startOffset(block);
	if (startOffset === undefined) {
		return undefined;
	}

	// Find the first line of the code block (the fence line)
	let endOfLine = startOffset;
	while (endOfLine < context.sourceBytes.length && context.sourceBytes[endOfLine] !== 0x0A) {
		endOfLine++;
	}

	const fenceLine = extractByteRange(context, startOffset, endOfLine).trim();

	// Extract the part after the backticks (e.g., "{python #id}" from "```{python #id}")
	const match = fenceLine.match(/^`{3,}(.*)$/);
	return match?.[1] || undefined;
}

function createRawBlockCell(block: RawBlock): vscode.NotebookCellData {
	return new vscode.NotebookCellData(
		vscode.NotebookCellKind.Code,
		ast.content(block),
		ast.format(block) || 'text' // 'latex', 'html', etc.
	);
}

/**
 * Create one or more markdown cells from accumulated blocks.
 * Splits at `<!-- cell -->` markers to preserve cell boundaries.
 */
function createMarkdownCells(
	blocks: Block[],
	context: ConversionContext,
	minStartOffset: number | undefined,
	maxEndOffset: number | undefined
): vscode.NotebookCellData[] {
	// Extract raw text from source using source locations
	const content = extractRawTextForBlocks(blocks, context, minStartOffset, maxEndOffset);

	// Split at cell boundary markers
	const parts = content.split(/\s*<!-- cell -->\s*/);

	const cells: vscode.NotebookCellData[] = [];
	for (const part of parts) {
		const trimmed = part.trim();
		if (trimmed) {
			cells.push(new vscode.NotebookCellData(
				vscode.NotebookCellKind.Markup,
				trimmed,
				'markdown'
			));
		}
	}

	return cells;
}

/**
 * Extract the raw source text for a sequence of blocks using their source locations.
 * This preserves exact formatting, whitespace, and Quarto-specific syntax.
 * @param minStartOffset If provided, start extraction from this byte offset (used to skip frontmatter).
 * @param maxEndOffset If provided, cap extraction at this byte offset (used to prevent
 *                     including content from following code blocks).
 */
function extractRawTextForBlocks(
	blocks: Block[],
	context: ConversionContext,
	minStartOffset: number | undefined,
	maxEndOffset: number | undefined
): string {
	if (blocks.length === 0) {
		return '';
	}

	// Use the Location property (l) on blocks for accurate source positions
	// Location offsets are character offsets, not byte offsets
	const firstBlock = blocks[0];
	const lastBlock = blocks[blocks.length - 1];

	// Try to get positions from Location property first
	let startOffset = ast.startOffset(firstBlock);
	let endOffset = ast.endOffset(lastBlock);

	if (startOffset === undefined || endOffset === undefined) {
		console.warn('[QMD Converter] Missing location info for blocks, using fallback extraction', {
			firstBlockType: firstBlock.t,
			lastBlockType: lastBlock.t,
			hasFirstLocation: !!firstBlock.l,
			hasLastLocation: !!lastBlock.l,
		});
		return blocks.map(block => extractRawTextForBlock(block, context)).join('\n\n');
	}

	// Cap start at minStartOffset to skip content before (e.g., frontmatter)
	if (minStartOffset !== undefined && startOffset < minStartOffset) {
		startOffset = minStartOffset;
	}

	// Cap at maxEndOffset to avoid including content from following blocks
	// But only if it makes sense (maxEndOffset > startOffset)
	if (maxEndOffset !== undefined && maxEndOffset > startOffset && endOffset > maxEndOffset) {
		endOffset = maxEndOffset;
	}

	// Safety check: ensure we have a valid range
	if (endOffset <= startOffset) {
		console.warn('[QMD Converter] Invalid offset range', {
			startOffset,
			endOffset,
			minStartOffset,
			maxEndOffset,
			firstBlockType: firstBlock.t,
			lastBlockType: lastBlock.t,
		});
		return blocks.map(block => extractRawTextForBlock(block, context)).join('\n\n');
	}

	// Location offsets are byte offsets, use byte-aware extraction
	return extractByteRange(context, startOffset, endOffset).trim();
}

/**
 * Extract a range of text using byte offsets.
 * The parser returns byte offsets, but JS strings use character offsets.
 */
function extractByteRange(
	context: ConversionContext,
	startByte: number,
	endByte: number
): string {
	// Bounds checking
	const maxLen = context.sourceBytes.length;
	const safeStart = Math.max(0, Math.min(startByte, maxLen));
	const safeEnd = Math.max(safeStart, Math.min(endByte, maxLen));

	if (safeStart >= safeEnd) {
		return '';
	}

	const decoder = new TextDecoder();
	const slice = context.sourceBytes.slice(safeStart, safeEnd);
	return decoder.decode(slice);
}

/**
 * Extract raw source text for a single block.
 */
function extractRawTextForBlock(
	block: Block,
	context: ConversionContext
): string {
	// Try Location property first (byte offsets)
	const startOffset = ast.startOffset(block);
	const endOffset = ast.endOffset(block);
	if (startOffset !== undefined && endOffset !== undefined) {
		return extractByteRange(context, startOffset, endOffset).trim();
	}

	// Fallback to source info pool (byte offsets)
	const sourceInfo = context.sourceInfoPool[block.s];
	if (sourceInfo) {
		return extractByteRange(context, sourceInfo.startOffset, sourceInfo.endOffset).trim();
	}

	throw new Error(`[QMD Converter] Block of type '${block.t}' is missing source location info`);
}

// =============================================================================
// SERIALIZATION: NotebookData → QMD
// =============================================================================

/** Reverse map from VS Code language ID to Quarto language */
const VSCODE_TO_QUARTO_MAP: Record<string, string> = {
	'python': 'python',
	'r': 'r',
	'julia': 'julia',
	'javascript': 'ojs',
	'mermaid': 'mermaid',
	'dot': 'dot',
};

/**
 * Convert a VS Code NotebookData back to QMD text format.
 * @param data The notebook data to serialize.
 * @returns The QMD text representation.
 */
export function convertFromNotebookData(data: vscode.NotebookData): string {
	const parts: string[] = [];
	let cellIndex = 0;

	// Check if first cell is frontmatter
	const firstCell = data.cells[0];
	if (firstCell?.metadata?.qmdCellType === 'frontmatter') {
		const content = firstCell.value.trim();
		if (content) {
			parts.push(content); // Already includes --- delimiters
		}
		cellIndex = 1; // Skip frontmatter cell in main loop
	}

	let prevCellWasMarkdown = false;

	for (let i = cellIndex; i < data.cells.length; i++) {
		const cell = data.cells[i];

		// Skip empty markdown cells
		if (cell.kind === vscode.NotebookCellKind.Markup && !cell.value.trim()) {
			continue;
		}

		if (cell.kind === vscode.NotebookCellKind.Markup) {
			// Insert cell boundary marker if previous cell was also markdown
			if (prevCellWasMarkdown) {
				parts.push(CELL_BOUNDARY_MARKER);
			}
			parts.push(cell.value);
			prevCellWasMarkdown = true;
		} else {
			// Code cell
			parts.push(serializeCodeCell(cell));
			prevCellWasMarkdown = false;
		}
	}

	return parts.join('\n\n') + '\n';
}

/**
 * Serialize a code cell to a fenced code block.
 */
function serializeCodeCell(cell: vscode.NotebookCellData): string {
	const language = cell.languageId;
	const code = cell.value;

	// Use raw fence info if available (preserves exact formatting)
	const qmdFenceInfo = cell.metadata?.qmdFenceInfo as string | undefined;
	if (qmdFenceInfo) {
		return '```' + qmdFenceInfo + '\n' + code + '\n```';
	}

	// Otherwise generate fence info from language
	const quartoLang = getQuartoLanguage(language);
	const fenceInfo = quartoLang ? `{${quartoLang}}` : '';

	return '```' + fenceInfo + '\n' + code + '\n```';
}


/**
 * Get Quarto language name from VS Code language ID.
 */
function getQuartoLanguage(vscodeLanguageId: string): string {
	return VSCODE_TO_QUARTO_MAP[vscodeLanguageId] || vscodeLanguageId;
}
