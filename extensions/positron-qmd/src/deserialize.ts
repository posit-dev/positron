/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { QmdDocument, Block, CodeBlock, RawBlock, SourceInfo } from './ast/index.js';
import * as ast from './ast/index.js';
import { TextDecoder, TextEncoder } from 'util';

const QUARTO_LANGUAGE_MAP: Record<string, string> = {
	'python': 'python',
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

interface ConversionContext {
	sourceText: string;
	sourceBytes: Uint8Array;
	sourceInfoPool: SourceInfo[];
}

interface FrontmatterResult {
	text: string;
	endOffset: number;
}

function extractFrontmatter(
	doc: QmdDocument,
	sourceBytes: Uint8Array
): FrontmatterResult | null {
	if (!doc.meta || Object.keys(doc.meta).length === 0) {
		return null;
	}

	const len = sourceBytes.length;

	if (len < 4 ||
		sourceBytes[0] !== 0x2D ||
		sourceBytes[1] !== 0x2D ||
		sourceBytes[2] !== 0x2D) {
		return null;
	}

	let pos = 3;
	if (sourceBytes[pos] === 0x0D) {
		pos++;
	}
	if (pos >= len || sourceBytes[pos] !== 0x0A) {
		return null;
	}
	pos++;

	while (pos < len - 2) {
		if (sourceBytes[pos] === 0x0A) {
			if (pos + 3 < len &&
				sourceBytes[pos + 1] === 0x2D &&
				sourceBytes[pos + 2] === 0x2D &&
				sourceBytes[pos + 3] === 0x2D) {
				let endOffset = pos + 4;
				if (endOffset < len && sourceBytes[endOffset] === 0x0D) {
					endOffset++;
				}
				if (endOffset < len && sourceBytes[endOffset] === 0x0A) {
					endOffset++;
				}

				const text = new TextDecoder().decode(sourceBytes.slice(0, endOffset)).trim();
				return { text, endOffset };
			}
		}
		pos++;
	}

	return null;
}

export function deserialize(
	doc: QmdDocument,
	sourceText: string
): vscode.NotebookData {
	const context: ConversionContext = {
		sourceText,
		sourceBytes: new TextEncoder().encode(sourceText),
		sourceInfoPool: doc.astContext.sourceInfoPool,
	};

	const cells: vscode.NotebookCellData[] = [];

	const frontmatter = extractFrontmatter(doc, context.sourceBytes);
	if (frontmatter) {
		const cell = new vscode.NotebookCellData(
			vscode.NotebookCellKind.Code,
			frontmatter.text,
			'yaml'
		);
		cell.metadata = { qmdCellType: 'frontmatter' };
		cells.push(cell);
	}

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
			cells.push(...createMarkdownCells(pendingMarkdownBlocks, context, minStartOffset, maxEndOffset));
			pendingMarkdownBlocks = [];
		}
	};

	for (const block of blocks) {
		if (block.t === 'CodeBlock') {
			flushMarkdownBlocks(ast.startOffset(block));
			cells.push(createCodeCell(block, context));
		} else if (block.t === 'RawBlock') {
			flushMarkdownBlocks(ast.startOffset(block));
			cells.push(createRawBlockCell(block));
		} else {
			pendingMarkdownBlocks.push(block);
		}
	}

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

	const fenceInfo = extractFenceInfo(block, context);
	if (fenceInfo) {
		cell.metadata = { qmdFenceInfo: fenceInfo };
	}

	return cell;
}

function extractFenceInfo(block: CodeBlock, context: ConversionContext): string | undefined {
	const startOffset = ast.startOffset(block);
	if (startOffset === undefined) {
		return undefined;
	}

	let endOfLine = startOffset;
	while (endOfLine < context.sourceBytes.length && context.sourceBytes[endOfLine] !== 0x0A) {
		endOfLine++;
	}

	const fenceLine = new TextDecoder().decode(context.sourceBytes.slice(startOffset, endOfLine)).trim();
	const match = fenceLine.match(/^`{3,}(.*)$/);
	return match?.[1] || undefined;
}

function createRawBlockCell(block: RawBlock): vscode.NotebookCellData {
	return new vscode.NotebookCellData(
		vscode.NotebookCellKind.Code,
		ast.content(block),
		ast.format(block) || 'text'
	);
}

function createMarkdownCells(
	blocks: Block[],
	context: ConversionContext,
	minStartOffset: number | undefined,
	maxEndOffset: number | undefined
): vscode.NotebookCellData[] {
	const content = extractRawTextForBlocks(blocks, context, minStartOffset, maxEndOffset);
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

function extractRawTextForBlocks(
	blocks: Block[],
	context: ConversionContext,
	minStartOffset: number | undefined,
	maxEndOffset: number | undefined
): string {
	if (blocks.length === 0) {
		return '';
	}

	const firstBlock = blocks[0];
	const lastBlock = blocks[blocks.length - 1];

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

	if (minStartOffset !== undefined && startOffset < minStartOffset) {
		startOffset = minStartOffset;
	}

	if (maxEndOffset !== undefined && maxEndOffset > startOffset && endOffset > maxEndOffset) {
		endOffset = maxEndOffset;
	}

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

	return new TextDecoder().decode(context.sourceBytes.slice(startOffset, endOffset));
}

function extractRawTextForBlock(
	block: Block,
	context: ConversionContext
): string {
	const startOffset = ast.startOffset(block);
	const endOffset = ast.endOffset(block);
	if (startOffset !== undefined && endOffset !== undefined) {
		return new TextDecoder().decode(context.sourceBytes.slice(startOffset, endOffset));
	}

	const sourceInfo = context.sourceInfoPool[block.s];
	if (sourceInfo) {
		return new TextDecoder().decode(context.sourceBytes.slice(sourceInfo.startOffset, sourceInfo.endOffset));
	}

	throw new Error(`[QMD Converter] Block of type '${block.t}' is missing source location info`);
}
