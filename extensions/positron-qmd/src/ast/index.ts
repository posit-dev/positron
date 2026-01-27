/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Re-export all types (type-only to avoid runtime import of .d.ts)
export type * from './types';

import type {
	Attr,
	AttrKeyValue,
	Block,
	CodeBlock,
	Div,
	Header,
	Inline,
	Link,
	Image,
	Location,
	MetaValue,
	MetaString,
	MetaInlines,
	MetaBlocks,
	MetaList,
	MetaMap,
	MetaBool,
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

/** Get language from first class (e.g., '{python}' or 'python') */
export function language(block: CodeBlock): string | undefined {
	return block.c[0][1][0];
}

/** Get attributes from a node that has Attr at c[0] (CodeBlock, Div, Link, Image, Code, etc.) */
export function attributes(node: { c: [Attr, ...unknown[]] }): Attr {
	return node.c[0];
}

/** Get format from a RawBlock (e.g., 'html', 'latex') */
export function format(block: RawBlock): string {
	return block.c[0];
}

/** Get identifier from an Attr tuple */
export function id(attr: Attr): string {
	return attr[0];
}

/** Get classes from an Attr tuple */
export function classes(attr: Attr): string[] {
	return attr[1];
}

/** Get key-value pairs from an Attr tuple */
export function keyvals(attr: Attr): AttrKeyValue[] {
	return attr[2];
}

/**
 * AST node accessor helpers.
 *
 * Provides readable access to Pandoc AST node properties without
 * needing to remember tuple indices. Use with discriminated union
 * narrowing:
 *
 * @example
 * ```typescript
 * if (block.t === 'CodeBlock') {
 *   const code = ast.CodeBlock.text(block);
 *   const lang = ast.CodeBlock.language(block);
 * }
 * ```
 */
export const helpers = {
	CodeBlock: {
		/** Get the identifier */
		id: (b: CodeBlock): string => b.c[0][0],

		/** Get CSS classes */
		classes: (b: CodeBlock): string[] => b.c[0][1],

		/** Get key-value attributes */
		keyvals: (b: CodeBlock): AttrKeyValue[] => b.c[0][2],

		/** Get a specific attribute value by key */
		getAttr: (b: CodeBlock, key: string): string | undefined =>
			b.c[0][2].find(([k]) => k === key)?.[1],
	},

	Header: {
		/** Get header level (1-6) */
		level: (b: Header): number => b.c[0],

		/** Get the full attribute tuple */
		attr: (b: Header): Attr => b.c[1],

		/** Get header id (for anchors) */
		id: (b: Header): string => b.c[1][0],

		/** Get header text as inline nodes */
		inlines: (b: Header): Inline[] => b.c[2],
	},


	Div: {
		/** Get the full attribute tuple */
		attr: (b: Div): Attr => b.c[0],

		/** Get the identifier */
		id: (b: Div): string => b.c[0][0],

		/** Get CSS classes */
		classes: (b: Div): string[] => b.c[0][1],

		/** Get contained blocks */
		blocks: (b: Div): Block[] => b.c[1],
	},

	Link: {
		/** Get the full attribute tuple */
		attr: (l: Link): Attr => l.c[0],

		/** Get link text as inline nodes */
		inlines: (l: Link): Inline[] => l.c[1],

		/** Get URL */
		url: (l: Link): string => l.c[2][0],

		/** Get title */
		title: (l: Link): string => l.c[2][1],
	},

	Image: {
		/** Get the full attribute tuple */
		attr: (i: Image): Attr => i.c[0],

		/** Get alt text as inline nodes */
		alt: (i: Image): Inline[] => i.c[1],

		/** Get image URL */
		url: (i: Image): string => i.c[2][0],

		/** Get title */
		title: (i: Image): string => i.c[2][1],
	},

	Attr: {
		/** Get identifier from attr tuple */
		id: (a: Attr): string => a[0],

		/** Get classes from attr tuple */
		classes: (a: Attr): string[] => a[1],

		/** Get key-value pairs from attr tuple */
		keyvals: (a: Attr): AttrKeyValue[] => a[2],

		/** Get a specific attribute value by key */
		get: (a: Attr, key: string): string | undefined =>
			a[2].find(([k]) => k === key)?.[1],

		/** Check if attr has a specific class */
		hasClass: (a: Attr, cls: string): boolean =>
			a[1].includes(cls),

		/** Create an empty attr tuple */
		empty: (): Attr => ['', [], []],
	},

	Loc: {
		/** Get start character offset */
		startOffset: (l: Location): number => l.b.o,

		/** Get end character offset */
		endOffset: (l: Location): number => l.e.o,

		/** Get start line (1-indexed) */
		startLine: (l: Location): number => l.b.l,

		/** Get end line (1-indexed) */
		endLine: (l: Location): number => l.e.l,

		/** Get start column (1-indexed) */
		startCol: (l: Location): number => l.b.c,

		/** Get end column (1-indexed) */
		endCol: (l: Location): number => l.e.c,
	},

	Meta: {
		/** Get string value from MetaString */
		string: (m: MetaString): string => m.c,

		/** Get boolean value from MetaBool */
		bool: (m: MetaBool): boolean => m.c,

		/** Get items from MetaList */
		list: (m: MetaList): MetaValue[] => m.c,

		/** Get record from MetaMap */
		map: (m: MetaMap): Record<string, MetaValue> => m.c,

		/** Get inlines from MetaInlines */
		inlines: (m: MetaInlines): Inline[] => m.c,

		/** Get blocks from MetaBlocks */
		blocks: (m: MetaBlocks): Block[] => m.c,
	},
} as const;
