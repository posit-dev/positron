/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

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
interface BaseNode {
	/** Node type discriminator */
	t: string;
	/** Index into astContext.sourceInfoPool for byte offsets */
	s: number;
	/** Optional source location */
	l?: Location;
}

/** Pandoc attribute tuple: [id, classes, key-value pairs] */
export type Attr = [string, string[], [string, string][]];

// --- Inline node types ---

/** Text string */
export interface StrInline extends BaseNode {
	t: 'Str';
	/** Text content */
	c: string;
}

/** Inter-word space */
export interface SpaceInline extends BaseNode {
	t: 'Space';
}

/** Soft line break (rendered as space or newline depending on context) */
export interface SoftBreakInline extends BaseNode {
	t: 'SoftBreak';
}

/** Hard line break */
export interface LineBreakInline extends BaseNode {
	t: 'LineBreak';
}

/** Bold text */
export interface StrongInline extends BaseNode {
	t: 'Strong';
	/** Inline content */
	c: InlineNode[];
}

/** Italic text */
export interface EmphInline extends BaseNode {
	t: 'Emph';
	/** Inline content */
	c: InlineNode[];
}

/** Inline code */
export interface CodeInline extends BaseNode {
	t: 'Code';
	/** [attributes, code text] */
	c: [Attr, string];
}

/** Hyperlink */
export interface LinkInline extends BaseNode {
	t: 'Link';
	/** [attributes, link text, [url, title]] */
	c: [Attr, InlineNode[], [string, string]];
}

/** Image */
export interface ImageInline extends BaseNode {
	t: 'Image';
	/** [attributes, alt text, [url, title]] */
	c: [Attr, InlineNode[], [string, string]];
}

/** Footnote or endnote */
export interface NoteInline extends BaseNode {
	t: 'Note';
	/** Note content as blocks */
	c: BlockNode[];
}

/** Union of all inline node types */
export type InlineNode =
	| StrInline
	| SpaceInline
	| SoftBreakInline
	| LineBreakInline
	| StrongInline
	| EmphInline
	| CodeInline
	| LinkInline
	| ImageInline
	| NoteInline;

// --- Block node types ---

/** Section header (h1-h6) */
export interface HeaderBlock extends BaseNode {
	t: 'Header';
	/** [level (1-6), attributes, heading text] */
	c: [number, Attr, InlineNode[]];
}

/** Paragraph */
export interface ParaBlock extends BaseNode {
	t: 'Para';
	/** Paragraph content */
	c: InlineNode[];
}

/** Plain text (not wrapped in paragraph tags) */
export interface PlainBlock extends BaseNode {
	t: 'Plain';
	/** Plain content */
	c: InlineNode[];
}

/** Unordered (bullet) list */
export interface BulletListBlock extends BaseNode {
	t: 'BulletList';
	/** List items, each item is an array of blocks */
	c: BlockNode[][];
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

/** Ordered list attributes: [start number, number style, delimiter style] */
export type ListAttributes = [number, { t: ListNumberStyle }, { t: ListNumberDelim }];

/** Ordered (numbered) list */
export interface OrderedListBlock extends BaseNode {
	t: 'OrderedList';
	/** [list attributes, list items] */
	c: [ListAttributes, BlockNode[][]];
}

/** Block quote */
export interface BlockQuoteBlock extends BaseNode {
	t: 'BlockQuote';
	/** Quoted content */
	c: BlockNode[];
}

/** Fenced or indented code block */
export interface CodeBlockBlock extends BaseNode {
	t: 'CodeBlock';
	/** [attributes, code content] */
	c: [Attr, string];
}

/** Horizontal rule (thematic break) */
export interface HorizontalRuleBlock extends BaseNode {
	t: 'HorizontalRule';
}

/** Generic block container (div) */
export interface DivBlock extends BaseNode {
	t: 'Div';
	/** [attributes, content blocks] */
	c: [Attr, BlockNode[]];
}

// --- Table structures ---

/** Table cell */
export interface TableCell {
	t: 'Cell';
	/** [attributes, alignment, rowspan, colspan, cell content] */
	c: [Attr, { t: string }, number, number, BlockNode[]];
}

/** Table row */
export interface TableRow {
	t: 'Row';
	/** [attributes, cells] */
	c: [Attr, TableCell[]];
}

/** Table header section */
export interface TableHead {
	t: 'TableHead';
	/** [attributes, header rows] */
	c: [Attr, TableRow[]];
}

/** Table body section */
export interface TableBody {
	t: 'TableBody';
	/** [attributes, row head columns count, intermediate head rows, body rows] */
	c: [Attr, number, TableRow[], TableRow[]];
}

/** Table footer section */
export interface TableFoot {
	t: 'TableFoot';
	/** [attributes, footer rows] */
	c: [Attr, TableRow[]];
}

/** Column specification */
export interface ColSpec {
	t: 'ColSpec';
	/** [alignment, width] */
	c: [{ t: string }, { t: string; c?: number }];
}

/** Table */
export interface TableBlock extends BaseNode {
	t: 'Table';
	/** [attributes, caption, column specs, head, bodies, foot] */
	c: [Attr, InlineNode[], ColSpec[], TableHead, TableBody[], TableFoot];
}

/** Raw content in a specific format (e.g., HTML, LaTeX) */
export interface RawBlock extends BaseNode {
	t: 'RawBlock';
	/** [format, raw content] */
	c: [string, string];
}

/** Union of all block node types */
export type BlockNode =
	| HeaderBlock
	| ParaBlock
	| PlainBlock
	| BulletListBlock
	| OrderedListBlock
	| BlockQuoteBlock
	| CodeBlockBlock
	| HorizontalRuleBlock
	| DivBlock
	| TableBlock
	| RawBlock;

// --- Meta values (document metadata) ---

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
	c: InlineNode[];
}

/** Block content metadata value */
export interface MetaBlocks {
	t: 'MetaBlocks';
	/** Block content */
	c: BlockNode[];
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

// --- Source mapping ---

/** Byte offset range for source mapping */
export interface SourceInfo {
	/** Start byte offset from beginning of source */
	startOffset: number;
	/** End byte offset from beginning of source */
	endOffset: number;
}

/** AST context containing source mapping information */
export interface ASTContext {
	/** Source files referenced by Location.f indices */
	files: unknown[];
	/** Maps top-level metadata keys to source info pool indices */
	metaTopLevelKeySources: Record<string, number>;
	/** Pool of source byte offset ranges, referenced by BaseNode.s */
	sourceInfoPool: SourceInfo[];
}

// --- Root document ---

/** Parsed QMD document */
export interface QmdDocument {
	/** Pandoc AST API version */
	'pandoc-api-version': number[];
	/** Document metadata (YAML frontmatter) */
	meta: Record<string, MetaValue>;
	/** Document content blocks */
	blocks: BlockNode[];
	/** Source mapping context */
	astContext: ASTContext;
}
