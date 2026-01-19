/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { TextDecoder, TextEncoder } from 'util';
import { QmdDocument, BlockNode, CodeBlockBlock, RawBlock, SourceInfo, MetaValue, MetaMap, MetaList, MetaString, MetaInlines, MetaBlocks, MetaBool, InlineNode } from './ast.js';

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

	const cells = convertBlocksToCells(doc.blocks, context);

	const notebookData = new vscode.NotebookData(cells);
	notebookData.metadata = {
		qmdMeta: doc.meta,
		pandocApiVersion: doc['pandoc-api-version'],
	};

	return notebookData;
}

function convertBlocksToCells(
	blocks: BlockNode[],
	context: ConversionContext
): vscode.NotebookCellData[] {
	const cells: vscode.NotebookCellData[] = [];
	let pendingMarkdownBlocks: BlockNode[] = [];

	for (const block of blocks) {
		if (block.t === 'CodeBlock') {
			// Flush pending markdown, capping at the start of this code block
			if (pendingMarkdownBlocks.length > 0) {
				// Use the block's location if available
				const blockStart = block.l?.b.o;
				// createMarkdownCells handles splitting at <!-- cell --> markers
				cells.push(...createMarkdownCells(pendingMarkdownBlocks, context, blockStart));
				pendingMarkdownBlocks = [];
			}
			cells.push(createCodeCell(block));
		} else if (block.t === 'RawBlock') {
			// Flush pending markdown
			if (pendingMarkdownBlocks.length > 0) {
				const blockStart = block.l?.b.o;
				cells.push(...createMarkdownCells(pendingMarkdownBlocks, context, blockStart));
				pendingMarkdownBlocks = [];
			}
			cells.push(createRawBlockCell(block));
		} else {
			// Accumulate markdown blocks (including Div, Header, Para, lists, etc.)
			pendingMarkdownBlocks.push(block);
		}
	}

	// Flush remaining markdown (no cap needed at end of document)
	if (pendingMarkdownBlocks.length > 0) {
		cells.push(...createMarkdownCells(pendingMarkdownBlocks, context, undefined));
	}

	return cells;
}

function createCodeCell(block: CodeBlockBlock): vscode.NotebookCellData {
	// CodeBlock content: [Attr, string]
	// Attr: [id, classes, keyvals]
	const [attr, code] = block.c as [
		[string, string[], [string, string][]],
		string
	];
	const [, classes] = attr;

	// First class is typically the language
	const rawLanguage = classes[0] || '';
	const language = QUARTO_LANGUAGE_MAP[rawLanguage.toLowerCase()] || rawLanguage || 'text';

	const cell = new vscode.NotebookCellData(
		vscode.NotebookCellKind.Code,
		code,
		language
	);

	// Store original attributes in metadata for round-trip
	cell.metadata = {
		qmdAttributes: attr,
	};

	return cell;
}

function createRawBlockCell(block: RawBlock): vscode.NotebookCellData {
	// RawBlock content: [format, string]
	const [format, content] = block.c as [string, string];

	return new vscode.NotebookCellData(
		vscode.NotebookCellKind.Code,
		content,
		format || 'text' // 'latex', 'html', etc.
	);
}

/**
 * Create one or more markdown cells from accumulated blocks.
 * Splits at `<!-- cell -->` markers to preserve cell boundaries.
 */
function createMarkdownCells(
	blocks: BlockNode[],
	context: ConversionContext,
	maxEndOffset: number | undefined
): vscode.NotebookCellData[] {
	// Extract raw text from source using source locations
	const content = extractRawTextForBlocks(blocks, context, maxEndOffset);

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
 * @param maxEndOffset If provided, cap extraction at this character offset (used to prevent
 *                     including content from following code blocks).
 */
function extractRawTextForBlocks(
	blocks: BlockNode[],
	context: ConversionContext,
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
	const startOffset = firstBlock.l?.b.o;
	let endOffset = lastBlock.l?.e.o;

	if (startOffset === undefined || endOffset === undefined) {
		console.warn('[QMD Converter] Missing location info for blocks, using fallback extraction', {
			firstBlockType: firstBlock.t,
			lastBlockType: lastBlock.t,
			hasFirstLocation: !!firstBlock.l,
			hasLastLocation: !!lastBlock.l,
		});
		return blocks.map(block => extractRawTextForBlock(block, context)).join('\n\n');
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
			maxEndOffset,
			firstBlockType: firstBlock.t,
			lastBlockType: lastBlock.t,
		});
		return blocks.map(block => extractRawTextForBlock(block, context)).join('\n\n');
	}

	// Bounds check
	if (startOffset < 0 || endOffset > context.sourceText.length) {
		console.warn('[QMD Converter] Offset out of bounds', {
			startOffset,
			endOffset,
			sourceLength: context.sourceText.length,
		});
	}

	// Location offsets are character offsets, use sourceText directly
	return context.sourceText.slice(startOffset, endOffset).trim();
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
	block: BlockNode,
	context: ConversionContext
): string {
	// Try Location property first (character offsets)
	if (block.l) {
		return context.sourceText.slice(block.l.b.o, block.l.e.o).trim();
	}

	// Fallback to source info pool (byte offsets)
	const sourceInfo = context.sourceInfoPool[block.s];
	if (sourceInfo) {
		return extractByteRange(context, sourceInfo.startOffset, sourceInfo.endOffset).trim();
	}

	// Last resort: extract text content from AST
	// Some blocks like HorizontalRule have no content
	if (block.t !== 'HorizontalRule') {
		return extractTextContentFallback(block.c);
	}
	return '';
}

/**
 * Fallback text extraction when source info is unavailable.
 * Recursively extracts string content from AST nodes.
 */
function extractTextContentFallback(content: unknown): string {
	if (typeof content === 'string') {
		return content;
	}
	if (Array.isArray(content)) {
		return content.map(extractTextContentFallback).join('');
	}
	if (content && typeof content === 'object') {
		const node = content as { t?: string; c?: unknown };
		if (node.t === 'Str') {
			return node.c as string;
		}
		if (node.t === 'Space') {
			return ' ';
		}
		if (node.t === 'SoftBreak') {
			return '\n';
		}
		if (node.t === 'LineBreak') {
			return '\n';
		}
		if (node.c !== undefined) {
			return extractTextContentFallback(node.c);
		}
	}
	return '';
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

	// Serialize front matter metadata if present
	const qmdMeta = data.metadata?.qmdMeta as Record<string, MetaValue> | undefined;
	if (qmdMeta && Object.keys(qmdMeta).length > 0) {
		parts.push(serializeYamlFrontMatter(qmdMeta));
	}

	let prevCellWasMarkdown = false;

	for (const cell of data.cells) {
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

	// Check if we have original attributes to preserve
	const qmdAttributes = cell.metadata?.qmdAttributes as [string, string[], [string, string][]] | undefined;

	let fenceInfo: string;
	if (qmdAttributes) {
		// Reconstruct from original attributes
		fenceInfo = formatAttributes(qmdAttributes);
	} else {
		// Map VS Code language ID to Quarto format
		const quartoLang = getQuartoLanguage(language);
		fenceInfo = quartoLang ? `{${quartoLang}}` : '';
	}

	return '```' + fenceInfo + '\n' + code + '\n```';
}

/**
 * Format code block attributes back to Quarto syntax.
 * Handles the Attr tuple: [id, classes, keyvals]
 */
function formatAttributes(attr: [string, string[], [string, string][]]): string {
	const [id, classes, keyvals] = attr;

	// If we have classes with braces, use them directly (they came from Quarto)
	// e.g., ['{python}'] or ['python']
	const mainClass = classes[0] || '';

	// If already has braces, use as-is
	if (mainClass.startsWith('{') && mainClass.endsWith('}')) {
		// Check for additional attributes
		if (!id && classes.length === 1 && keyvals.length === 0) {
			return mainClass;
		}
	}

	// Build attribute string
	const parts: string[] = [];

	// Add main language class
	if (mainClass) {
		// Strip braces if present, we'll add them
		const lang = mainClass.replace(/^\{|\}$/g, '');
		parts.push(lang);
	}

	// Add id if present
	if (id) {
		parts.push(`#${id}`);
	}

	// Add additional classes
	for (let i = 1; i < classes.length; i++) {
		parts.push(`.${classes[i]}`);
	}

	// Add key-value pairs
	for (const [key, value] of keyvals) {
		if (value) {
			parts.push(`${key}="${value}"`);
		} else {
			parts.push(key);
		}
	}

	if (parts.length === 0) {
		return '';
	}

	return `{${parts.join(' ')}}`;
}

/**
 * Get Quarto language name from VS Code language ID.
 */
function getQuartoLanguage(vscodeLanguageId: string): string {
	return VSCODE_TO_QUARTO_MAP[vscodeLanguageId] || vscodeLanguageId;
}

/**
 * Serialize document metadata back to YAML front matter.
 */
function serializeYamlFrontMatter(meta: Record<string, MetaValue>): string {
	const plain = convertMetaToPlain(meta);
	const yaml = serializeYaml(plain, 0);
	return '---\n' + yaml + '---';
}

/**
 * Convert Pandoc MetaValue objects to plain JavaScript values.
 */
function convertMetaToPlain(meta: Record<string, MetaValue>): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(meta)) {
		result[key] = metaValueToPlain(value);
	}
	return result;
}

/**
 * Convert a single MetaValue to a plain JavaScript value.
 */
function metaValueToPlain(value: MetaValue): unknown {
	switch (value.t) {
		case 'MetaString':
			return (value as MetaString).c;
		case 'MetaBool':
			return (value as MetaBool).c;
		case 'MetaInlines':
			return inlinesToText((value as MetaInlines).c);
		case 'MetaBlocks':
			// For blocks, extract text content
			return (value as MetaBlocks).c.map(block => extractTextContentFallback(block)).join('\n');
		case 'MetaList':
			return (value as MetaList).c.map(metaValueToPlain);
		case 'MetaMap':
			return convertMetaToPlain((value as MetaMap).c);
		default:
			return null;
	}
}

/**
 * Convert inline nodes to plain text.
 */
function inlinesToText(inlines: InlineNode[]): string {
	return inlines.map(inline => {
		switch (inline.t) {
			case 'Str':
				return inline.c;
			case 'Space':
				return ' ';
			case 'SoftBreak':
			case 'LineBreak':
				return '\n';
			case 'Strong':
			case 'Emph':
				return inlinesToText(inline.c);
			case 'Code':
				return inline.c[1];
			case 'Link':
			case 'Image':
				return inlinesToText(inline.c[1]);
			default:
				return '';
		}
	}).join('');
}

/**
 * Simple YAML serializer for basic types.
 */
function serializeYaml(value: unknown, indent: number): string {
	const spaces = '  '.repeat(indent);

	if (value === null || value === undefined) {
		return 'null\n';
	}

	if (typeof value === 'string') {
		// Check if string needs quoting
		if (needsQuoting(value)) {
			return `"${escapeYamlString(value)}"\n`;
		}
		return `${value}\n`;
	}

	if (typeof value === 'number') {
		return `${value}\n`;
	}

	if (typeof value === 'boolean') {
		return value ? 'true\n' : 'false\n';
	}

	if (Array.isArray(value)) {
		if (value.length === 0) {
			return '[]\n';
		}
		let result = '\n';
		for (const item of value) {
			const itemYaml = serializeYaml(item, indent + 1);
			if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
				result += `${spaces}- ${itemYaml.trimStart()}`;
			} else {
				result += `${spaces}- ${itemYaml}`;
			}
		}
		return result;
	}

	if (typeof value === 'object') {
		const obj = value as Record<string, unknown>;
		const keys = Object.keys(obj);
		if (keys.length === 0) {
			return '{}\n';
		}
		let result = indent === 0 ? '' : '\n';
		for (const key of keys) {
			const valueYaml = serializeYaml(obj[key], indent + 1);
			if (typeof obj[key] === 'object' && obj[key] !== null) {
				result += `${spaces}${key}:${valueYaml}`;
			} else {
				result += `${spaces}${key}: ${valueYaml}`;
			}
		}
		return result;
	}

	return `${value}\n`;
}

/**
 * Check if a string needs quoting in YAML.
 */
function needsQuoting(str: string): boolean {
	// Quote if empty, starts/ends with whitespace, or contains special chars
	if (str === '' || str.trim() !== str) {
		return true;
	}
	// Quote if contains YAML special characters
	if (/[:#\[\]{}|>&*!?,\n]/.test(str)) {
		return true;
	}
	// Quote if it looks like a number or boolean
	if (/^(true|false|yes|no|null|\d+\.?\d*|0x[0-9a-fA-F]+)$/i.test(str)) {
		return true;
	}
	return false;
}

/**
 * Escape special characters in a YAML string.
 */
function escapeYamlString(str: string): string {
	return str
		.replace(/\\/g, '\\\\')
		.replace(/"/g, '\\"')
		.replace(/\n/g, '\\n')
		.replace(/\r/g, '\\r')
		.replace(/\t/g, '\\t');
}
