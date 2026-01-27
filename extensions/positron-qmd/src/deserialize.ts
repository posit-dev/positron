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
const TRAILING_NEWLINE_REGEX = /\r?\n$/;

function trimTrailingNewline(s: string): string {
	return s.replace(TRAILING_NEWLINE_REGEX, '');
}

export function deserialize(
	doc: QmdDocument,
	content: Uint8Array
): vscode.NotebookData {
	const decoder = new TextDecoder();
	const cells: vscode.NotebookCellData[] = [];

	const frontmatter = ast.frontmatterBytes(doc, content);
	if (frontmatter) {
		const value = trimTrailingNewline(decoder.decode(frontmatter));
		const cell = new vscode.NotebookCellData(
			vscode.NotebookCellKind.Code,
			value,
			'yaml'
		);
		cell.metadata = { qmdCellType: 'frontmatter' };
		cells.push(cell);
	}

	const contentCells = convertBlocksToCells(doc.blocks, content, decoder);
	cells.push(...contentCells);

	const notebookData = new vscode.NotebookData(cells);
	notebookData.metadata = {
		pandocApiVersion: doc['pandoc-api-version'],
	};

	return notebookData;
}

function convertBlocksToCells(
	blocks: Block[],
	content: Uint8Array,
	decoder: TextDecoder
): vscode.NotebookCellData[] {
	const cells: vscode.NotebookCellData[] = [];
	let pendingMarkdownBlocks: Block[] = [];

	const flushMarkdownBlocks = () => {
		if (pendingMarkdownBlocks.length > 0) {
			cells.push(...createMarkdownCells(pendingMarkdownBlocks, content, decoder));
			pendingMarkdownBlocks = [];
		}
	};

	for (const block of blocks) {
		if (block.t === 'CodeBlock') {
			flushMarkdownBlocks();
			cells.push(createCodeCell(block, content, decoder));
		} else if (block.t === 'RawBlock') {
			flushMarkdownBlocks();
			cells.push(createRawBlockCell(block));
		} else {
			pendingMarkdownBlocks.push(block);
		}
	}

	flushMarkdownBlocks();

	return cells;
}

function createCodeCell(block: CodeBlock, content: Uint8Array, decoder: TextDecoder): vscode.NotebookCellData {
	const code = ast.content(block);
	const rawLanguage = (ast.language(block) ?? '').replace(BRACE_REGEX, '').toLowerCase();
	const language = QUARTO_TO_VSCODE_LANGUAGE[rawLanguage] || rawLanguage || 'text';

	const cell = new vscode.NotebookCellData(
		vscode.NotebookCellKind.Code,
		code,
		language
	);

	const fenceInfo = extractFenceInfo(block, content, decoder);
	if (fenceInfo) {
		cell.metadata = { qmdFenceInfo: fenceInfo };
	}

	return cell;
}

function extractFenceInfo(block: CodeBlock, content: Uint8Array, decoder: TextDecoder): string | undefined {
	const startOffset = ast.startOffset(block);
	if (startOffset === undefined) {
		return undefined;
	}

	let endOfLine = startOffset;
	while (endOfLine < content.length && content[endOfLine] !== 0x0A) {
		endOfLine++;
	}

	const fenceLine = decoder.decode(content.slice(startOffset, endOfLine)).trim();
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
	decoder: TextDecoder
): vscode.NotebookCellData[] {
	const text = extractRawTextForBlocks(blocks, content, decoder);
	const parts = text.split(CELL_MARKER_REGEX);

	const cells: vscode.NotebookCellData[] = [];
	for (const part of parts) {
		const trimmed = trimTrailingNewline(part);
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

function extractRawTextForBlocks(blocks: Block[], content: Uint8Array, decoder: TextDecoder): string {
	if (blocks.length === 0) {
		return '';
	}

	const firstBlock = blocks[0];
	const lastBlock = blocks[blocks.length - 1];

	const startOffset = ast.startOffset(firstBlock);
	const endOffset = ast.endOffset(lastBlock);

	if (startOffset === undefined || endOffset === undefined) {
		throw new Error(`[QMD Converter] Missing location info for blocks: ${firstBlock.t} to ${lastBlock.t}`);
	}

	return decoder.decode(content.slice(startOffset, endOffset));
}
