/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { QmdDocument, Block, CodeBlock, RawBlock } from './ast/index.js';
import * as ast from './ast/index.js';
import { CELL_MARKER_REGEX, QUARTO_TO_VSCODE_LANGUAGE } from './constants.js';
import { TextDecoder } from 'util';

/** Convert parsed QMD document to VS Code NotebookData */
export function deserialize(
	doc: QmdDocument,
	content: Uint8Array
): vscode.NotebookData {
	const decoder = new TextDecoder();
	const cells: vscode.NotebookCellData[] = [];

	const frontmatterCell = createFrontmatterCell(doc, content, decoder);
	if (frontmatterCell) {
		cells.push(frontmatterCell);
	}

	const contentCells = createContentCells(doc, content, decoder);
	cells.push(...contentCells);

	const notebookData = new vscode.NotebookData(cells);
	notebookData.metadata = {
		pandocApiVersion: doc['pandoc-api-version'],
	};

	return notebookData;
}

/** Remove trailing newline from string */
function trimTrailingNewline(s: string): string {
	return s.replace(/\r?\n$/, '');
}

/** Create YAML frontmatter cell if document has metadata */
function createFrontmatterCell(
	doc: QmdDocument,
	content: Uint8Array,
	decoder: TextDecoder
): vscode.NotebookCellData | undefined {
	const bytes = ast.frontmatterBytes(doc, content);
	if (!bytes) {
		return undefined;
	}
	const value = trimTrailingNewline(decoder.decode(bytes));
	const cell = new vscode.NotebookCellData(
		vscode.NotebookCellKind.Code,
		value,
		'yaml'
	);
	cell.metadata = { qmdCellType: 'frontmatter' };
	return cell;
}

/** Convert document blocks to notebook cells, grouping markdown blocks together */
function createContentCells(
	doc: QmdDocument,
	content: Uint8Array,
	decoder: TextDecoder
): vscode.NotebookCellData[] {
	const cells: vscode.NotebookCellData[] = [];

	let pendingBlocks: Block[] = [];
	const flush = () => {
		if (pendingBlocks.length > 0) {
			cells.push(...createMarkdownCells(pendingBlocks, content, decoder));
			pendingBlocks = [];
		}
	};

	for (const block of doc.blocks) {
		if (block.t === 'CodeBlock') {
			flush();
			cells.push(createCodeCell(block));
		} else if (block.t === 'RawBlock') {
			flush();
			cells.push(createRawCell(block));
		} else {
			pendingBlocks.push(block);
		}
	}

	flush();

	return cells;
}

/** Create code cell from executable code block */
function createCodeCell(block: CodeBlock): vscode.NotebookCellData {
	const code = ast.content(block);
	const rawLanguage = ast.language(block) ?? '';
	const language = QUARTO_TO_VSCODE_LANGUAGE[rawLanguage] || rawLanguage || 'text';
	return new vscode.NotebookCellData(
		vscode.NotebookCellKind.Code,
		code,
		language
	);
}

/** Create code cell from raw block (e.g., latex, html) */
function createRawCell(block: RawBlock): vscode.NotebookCellData {
	return new vscode.NotebookCellData(
		vscode.NotebookCellKind.Code,
		ast.content(block),
		ast.format(block)
	);
}

/** Create markdown cells from consecutive non-code blocks, splitting on cell markers */
function createMarkdownCells(
	blocks: Block[],
	content: Uint8Array,
	decoder: TextDecoder
): vscode.NotebookCellData[] {
	const bytes = ast.blockBytes(blocks, content);
	const text = decoder.decode(bytes);
	const parts = text.split(CELL_MARKER_REGEX);

	return parts.map(part => new vscode.NotebookCellData(
		vscode.NotebookCellKind.Markup,
		trimTrailingNewline(part),
		'markdown'
	));
}
