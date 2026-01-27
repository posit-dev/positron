/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Pandoc AST type definitions.
 *
 * Type names match Pandoc's native naming (e.g., `CodeBlock`, `Para`, `Str`).
 * All node types have a `t` discriminator for TypeScript narrowing:
 *
 * @example
 * ```typescript
 * if (block.t === 'CodeBlock') {
 *   // block is narrowed to CodeBlock
 * }
 * ```
 */

//#region Common Types

/** Source position within a file */
export interface Position {
	/** Column number (1-indexed) */
	c: number;
	/** Line number (1-indexed) */
	l: number;
	/** Byte offset from start of file */
	o: number;
}

/** Source location span */
export interface Location {
	/** Beginning position */
	b: Position;
	/** Ending position */
	e: Position;
	/** File index in astContext.files */
	f: number;
}

/** Base AST node with type tag and source info */
export interface Node {
	/** Node type discriminator */
	t: string;
	/** Index into astContext.sourceInfoPool for byte offsets */
	s: number;
	/** Optional source location */
	l?: Location;
}

/** Pandoc attribute key-value pair */
export type AttrKeyValue = [key: string, value: string];

/** Pandoc attribute tuple */
export type Attr = [identifier: string, classes: string[], attributes: AttrKeyValue[]];

/** Link/image target */
export type Target = [url: string, title: string];

//#endregion Common Types

//#region Inline Nodes

/** Text string */
export interface Str extends Node {
	t: 'Str';
	/** Text content */
	c: string;
}

/** Inter-word space */
export interface Space extends Node {
	t: 'Space';
}

/** Soft line break (rendered as space or newline depending on context) */
export interface SoftBreak extends Node {
	t: 'SoftBreak';
}

/** Hard line break */
export interface LineBreak extends Node {
	t: 'LineBreak';
}

/** Bold text */
export interface Strong extends Node {
	t: 'Strong';
	/** Inline content */
	c: Inline[];
}

/** Italic text */
export interface Emph extends Node {
	t: 'Emph';
	/** Inline content */
	c: Inline[];
}

/** Inline code */
export interface Code extends Node {
	t: 'Code';
	c: [attributes: Attr, text: string];
}

/** Hyperlink */
export interface Link extends Node {
	t: 'Link';
	c: [attributes: Attr, inlines: Inline[], target: Target];
}

/** Image */
export interface Image extends Node {
	t: 'Image';
	c: [attributes: Attr, altText: Inline[], target: Target];
}

/** Footnote or endnote */
export interface Note extends Node {
	t: 'Note';
	/** Note content as blocks */
	c: Block[];
}

/** Union of all inline node types */
export type Inline =
	| Str
	| Space
	| SoftBreak
	| LineBreak
	| Strong
	| Emph
	| Code
	| Link
	| Image
	| Note;

//#endregion Inline Nodes

//#region Block Nodes

/** Section header (h1-h6) */
export interface Header extends Node {
	t: 'Header';
	c: [level: number, attributes: Attr, inlines: Inline[]];
}

/** Paragraph */
export interface Para extends Node {
	t: 'Para';
	/** Paragraph content */
	c: Inline[];
}

/** Plain text (not wrapped in paragraph tags) */
export interface Plain extends Node {
	t: 'Plain';
	/** Plain content */
	c: Inline[];
}

/** Unordered (bullet) list */
export interface BulletList extends Node {
	t: 'BulletList';
	/** List items, each item is an array of blocks */
	c: Block[][];
}

/** Ordered list number style */
export type ListNumberStyle =
	| 'DefaultStyle'
	| 'Example'
	| 'Decimal'
	| 'LowerRoman'
	| 'UpperRoman'
	| 'LowerAlpha'
	| 'UpperAlpha';

/** Ordered list delimiter style */
export type ListNumberDelim =
	| 'DefaultDelim'
	| 'Period'
	| 'OneParen'
	| 'TwoParens';

/** Ordered list attributes */
export type ListAttributes = [startNumber: number, style: { t: ListNumberStyle }, delimiter: { t: ListNumberDelim }];

/** Ordered (numbered) list */
export interface OrderedList extends Node {
	t: 'OrderedList';
	c: [listAttributes: ListAttributes, items: Block[][]];
}

/** Block quote */
export interface BlockQuote extends Node {
	t: 'BlockQuote';
	/** Quoted content */
	c: Block[];
}

/** Fenced or indented code block */
export interface CodeBlock extends Node {
	t: 'CodeBlock';
	c: [attributes: Attr, text: string];
}

/** Horizontal rule (thematic break) */
export interface HorizontalRule extends Node {
	t: 'HorizontalRule';
}

/** Generic block container (div) */
export interface Div extends Node {
	t: 'Div';
	c: [attributes: Attr, blocks: Block[]];
}

/** Raw content in a specific format (e.g., HTML, LaTeX) */
export interface RawBlock extends Node {
	t: 'RawBlock';
	c: [format: string, content: string];
}

//#endregion Block Nodes

//#region Table

/** Table cell */
export interface TableCell {
	t: 'Cell';
	c: [attributes: Attr, alignment: { t: string }, rowSpan: number, colSpan: number, blocks: Block[]];
}

/** Table row */
export interface TableRow {
	t: 'Row';
	c: [attributes: Attr, cells: TableCell[]];
}

/** Table header section */
export interface TableHead {
	t: 'TableHead';
	c: [attributes: Attr, rows: TableRow[]];
}

/** Table body section */
export interface TableBody {
	t: 'TableBody';
	c: [attributes: Attr, rowHeadColumns: number, headRows: TableRow[], bodyRows: TableRow[]];
}

/** Table footer section */
export interface TableFoot {
	t: 'TableFoot';
	c: [attributes: Attr, rows: TableRow[]];
}

/** Column specification */
export interface ColSpec {
	t: 'ColSpec';
	c: [alignment: { t: string }, width: { t: string; c?: number }];
}

/** Table */
export interface Table extends Node {
	t: 'Table';
	c: [attributes: Attr, caption: Inline[], colSpecs: ColSpec[], head: TableHead, bodies: TableBody[], foot: TableFoot];
}

//#endregion Table

//#region Block Union

/** Union of all block node types */
export type Block =
	| Header
	| Para
	| Plain
	| BulletList
	| OrderedList
	| BlockQuote
	| CodeBlock
	| HorizontalRule
	| Div
	| Table
	| RawBlock;

//#endregion Block Union

//#region Meta Values

/** String metadata value */
export interface MetaString {
	t: 'MetaString';
	/** String content */
	c: string;
}

/** Inline content metadata value */
export interface MetaInlines {
	t: 'MetaInlines';
	/** Inline content */
	c: Inline[];
}

/** Block content metadata value */
export interface MetaBlocks {
	t: 'MetaBlocks';
	/** Block content */
	c: Block[];
}

/** List metadata value */
export interface MetaList {
	t: 'MetaList';
	/** List items */
	c: MetaValue[];
}

/** Map/object metadata value */
export interface MetaMap {
	t: 'MetaMap';
	/** Key-value pairs */
	c: Record<string, MetaValue>;
}

/** Boolean metadata value */
export interface MetaBool {
	t: 'MetaBool';
	/** Boolean value */
	c: boolean;
}

/** Union of all metadata value types */
export type MetaValue =
	| MetaString
	| MetaInlines
	| MetaBlocks
	| MetaList
	| MetaMap
	| MetaBool;

//#endregion Meta Values

//#region Source Mapping

/**
 * Compact source info entry in sourceInfoPool.
 * Format: {"r": [start, end], "t": type_code, "d": data}
 */
export interface SourceInfoPoolEntry {
	/** Range [startOffset, endOffset] */
	r: [start: number, end: number];
	/** Type code: 0=Original (from file), 1=Substring (child of another entry) */
	t: number;
	/** Data: file_id for type 0, parent_id for type 1 */
	d: number;
}

/** AST context containing source mapping information */
export interface ASTContext {
	/** Source files referenced by Location.f indices */
	files: unknown[];
	/** Maps top-level metadata keys to source info pool indices */
	metaTopLevelKeySources: Record<string, number>;
	/** Pool of source info entries, referenced by Node.s */
	sourceInfoPool: SourceInfoPoolEntry[];
}

//#endregion Source Mapping

//#region Document

/** Parsed QMD document */
export interface QmdDocument {
	/** Pandoc AST API version */
	'pandoc-api-version': number[];
	/** Document metadata (YAML frontmatter) */
	meta: Record<string, MetaValue>;
	/** Document content blocks */
	blocks: Block[];
	/** Source mapping context */
	astContext: ASTContext;
}

//#endregion Document

