/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Re-export all types (type-only to avoid runtime import of .d.ts)
export type * from './types';

import type {
	Block,
	CodeBlock,
	Node,
	QmdDocument,
	RawBlock,
} from './types';

/** Check if document has YAML frontmatter metadata */
export function hasMeta(doc: QmdDocument): boolean {
	return doc.meta && Object.keys(doc.meta).length > 0;
}

/**
 * Get frontmatter byte range [start, end], or undefined if no frontmatter.
 * When a document has meta, sourceInfoPool[0] is the full frontmatter block including --- delimiters.
 */
export function frontmatterRange(doc: QmdDocument): [start: number, end: number] | undefined {
	if (!hasMeta(doc)) {
		return undefined;
	}
	return doc.astContext.sourceInfoPool[0].r;
}

/** Extract frontmatter bytes from content, or undefined if no frontmatter */
export function frontmatterBytes(doc: QmdDocument, content: Uint8Array): Uint8Array | undefined {
	const range = frontmatterRange(doc);
	if (!range) {
		return undefined;
	}
	const [start, end] = range;
	return content.slice(start, end);
}

/** Extract raw bytes spanning from first to last block */
export function blockBytes(blocks: Block[], content: Uint8Array): Uint8Array {
	if (blocks.length === 0) {
		return new Uint8Array();
	}
	const start = startOffset(blocks[0]);
	const end = endOffset(blocks[blocks.length - 1]);
	if (start === undefined || end === undefined) {
		throw new Error(`Missing location info for blocks`);
	}
	return content.slice(start, end);
}

/** Get start byte offset from any node, or undefined if no location info */
export function startOffset(node: Node): number | undefined {
	return node.l?.b.o;
}

/** Get end byte offset from any node, or undefined if no location info */
export function endOffset(node: Node): number | undefined {
	return node.l?.e.o;
}

/** Get text content from a CodeBlock or RawBlock */
export function content(block: CodeBlock | RawBlock): string {
	return block.c[1];
}

/** Get language from first class, normalized (e.g., 'python' from '{python}') */
export function language(block: CodeBlock): string | undefined {
	return block.c[0][1][0]?.replace(/^\{|\}$/g, '').toLowerCase();
}

/** Get format from a RawBlock (e.g., 'html', 'latex') */
export function format(block: RawBlock): string {
	return block.c[0];
}
