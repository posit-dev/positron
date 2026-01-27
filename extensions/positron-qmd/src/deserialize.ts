/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { QmdDocument, Block, CodeBlock, RawBlock } from './ast/index.js';
import * as ast from './ast/index.js';
import { TextDecoder } from 'util';

const QUARTO_TO_VSCODE_LANGUAGE: Record<string, string> = {
	'ojs': 'javascript',
};

const BRACE_REGEX = /^\{|\}$/g;
const FENCE_LINE_REGEX = /^`{3,}(.*)$/;
const CELL_MARKER_REGEX = /\s*<!-- cell -->\s*/;

interface FrontmatterResult {
	text: string;
	endOffset: number;
}

function extractFrontmatter(
	doc: QmdDocument,
	content: Uint8Array
): FrontmatterResult | null {
	if (!doc.meta || Object.keys(doc.meta).length === 0) {
		return null;
	}

	const len = content.length;

	if (len < 4 ||
		content[0] !== 0x2D ||
		content[1] !== 0x2D ||
		content[2] !== 0x2D) {
		return null;
	}

	let pos = 3;
	if (content[pos] === 0x0D) {
		pos++;
	}
	if (pos >= len || content[pos] !== 0x0A) {
		return null;
	}
	pos++;

	while (pos < len - 2) {
		if (content[pos] === 0x0A) {
			if (pos + 3 < len &&
				content[pos + 1] === 0x2D &&
				content[pos + 2] === 0x2D &&
				content[pos + 3] === 0x2D) {
				let endOffset = pos + 4;
				if (endOffset < len && content[endOffset] === 0x0D) {
					endOffset++;
				}
				if (endOffset < len && content[endOffset] === 0x0A) {
					endOffset++;
				}

				const text = new TextDecoder().decode(content.slice(0, endOffset)).trim();
				return { text, endOffset };
			}
		}
		pos++;
	}

	return null;
}

export function deserialize(
	doc: QmdDocument,
	content: Uint8Array
): vscode.NotebookData {
	const cells: vscode.NotebookCellData[] = [];

	const frontmatter = extractFrontmatter(doc, content);
	if (frontmatter) {
		const cell = new vscode.NotebookCellData(
			vscode.NotebookCellKind.Code,
			frontmatter.text,
			'yaml'
		);
		cell.metadata = { qmdCellType: 'frontmatter' };
		cells.push(cell);
	}

	const contentCells = convertBlocksToCells(doc.blocks, content);
	cells.push(...contentCells);

	const notebookData = new vscode.NotebookData(cells);
	notebookData.metadata = {
		pandocApiVersion: doc['pandoc-api-version'],
	};

	return notebookData;
}

function convertBlocksToCells(
	blocks: Block[],
	content: Uint8Array
): vscode.NotebookCellData[] {
	const cells: vscode.NotebookCellData[] = [];
	let pendingMarkdownBlocks: Block[] = [];

	const flushMarkdownBlocks = (maxEndOffset?: number) => {
		if (pendingMarkdownBlocks.length > 0) {
			cells.push(...createMarkdownCells(pendingMarkdownBlocks, content, maxEndOffset));
			pendingMarkdownBlocks = [];
		}
	};

	for (const block of blocks) {
		if (block.t === 'CodeBlock') {
			flushMarkdownBlocks(ast.startOffset(block));
			cells.push(createCodeCell(block, content));
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

function createCodeCell(block: CodeBlock, content: Uint8Array): vscode.NotebookCellData {
	const code = ast.content(block);
	const rawLanguage = (ast.language(block) ?? '').replace(BRACE_REGEX, '').toLowerCase();
	const language = QUARTO_TO_VSCODE_LANGUAGE[rawLanguage] || rawLanguage || 'text';

	const cell = new vscode.NotebookCellData(
		vscode.NotebookCellKind.Code,
		code,
		language
	);

	const fenceInfo = extractFenceInfo(block, content);
	if (fenceInfo) {
		cell.metadata = { qmdFenceInfo: fenceInfo };
	}

	return cell;
}

function extractFenceInfo(block: CodeBlock, content: Uint8Array): string | undefined {
	const startOffset = ast.startOffset(block);
	if (startOffset === undefined) {
		return undefined;
	}

	let endOfLine = startOffset;
	while (endOfLine < content.length && content[endOfLine] !== 0x0A) {
		endOfLine++;
	}

	const fenceLine = new TextDecoder().decode(content.slice(startOffset, endOfLine)).trim();
	const match = fenceLine.match(FENCE_LINE_REGEX);
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
	content: Uint8Array,
	maxEndOffset: number | undefined
): vscode.NotebookCellData[] {
	const text = extractRawTextForBlocks(blocks, content, maxEndOffset);
	const parts = text.split(CELL_MARKER_REGEX);

	const cells: vscode.NotebookCellData[] = [];
	for (const part of parts) {
		const trimmed = trimTrailingNewlines(part);
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

function trimTrailingNewlines(text: string): string {
	let end = text.length;
	while (end > 0 && (text[end - 1] === '\n' || text[end - 1] === '\r')) {
		end--;
	}
	return text.slice(0, end);
}

function extractRawTextForBlocks(
	blocks: Block[],
	content: Uint8Array,
	maxEndOffset: number | undefined
): string {
	if (blocks.length === 0) {
		return '';
	}

	const firstBlock = blocks[0];
	const lastBlock = blocks[blocks.length - 1];

	const startOffset = ast.startOffset(firstBlock);
	let endOffset = ast.endOffset(lastBlock);

	if (startOffset === undefined || endOffset === undefined) {
		throw new Error(`[QMD Converter] Missing location info for blocks: ${firstBlock.t} to ${lastBlock.t}`);
	}

	if (maxEndOffset !== undefined && maxEndOffset > startOffset && endOffset > maxEndOffset) {
		endOffset = maxEndOffset;
	}

	return new TextDecoder().decode(content.slice(startOffset, endOffset));
}
