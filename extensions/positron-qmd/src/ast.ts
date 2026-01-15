/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Location info for source mapping
export interface Position {
	c: number; // column
	l: number; // line
	o: number; // offset
}

export interface Location {
	b: Position; // begin
	e: Position; // end
	f: number; // file index
}

// Base AST node
interface BaseNode {
	t: string;
	s: number; // source info pool index
	l?: Location;
}

// Attr tuple: [id, classes, key-value pairs]
export type Attr = [string, string[], [string, string][]];

// Inline node types
export interface StrInline extends BaseNode {
	t: 'Str';
	c: string;
}

export interface SpaceInline extends BaseNode {
	t: 'Space';
}

export interface SoftBreakInline extends BaseNode {
	t: 'SoftBreak';
}

export interface LineBreakInline extends BaseNode {
	t: 'LineBreak';
}

export interface StrongInline extends BaseNode {
	t: 'Strong';
	c: InlineNode[];
}

export interface EmphInline extends BaseNode {
	t: 'Emph';
	c: InlineNode[];
}

export interface CodeInline extends BaseNode {
	t: 'Code';
	c: [Attr, string];
}

export interface LinkInline extends BaseNode {
	t: 'Link';
	c: [Attr, InlineNode[], [string, string]]; // [attr, inlines, [url, title]]
}

export interface ImageInline extends BaseNode {
	t: 'Image';
	c: [Attr, InlineNode[], [string, string]]; // [attr, alt inlines, [url, title]]
}

export interface NoteInline extends BaseNode {
	t: 'Note';
	c: BlockNode[];
}

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

// Block node types
export interface HeaderBlock extends BaseNode {
	t: 'Header';
	c: [number, Attr, InlineNode[]]; // [level, attr, inlines]
}

export interface ParaBlock extends BaseNode {
	t: 'Para';
	c: InlineNode[];
}

export interface PlainBlock extends BaseNode {
	t: 'Plain';
	c: InlineNode[];
}

export interface BulletListBlock extends BaseNode {
	t: 'BulletList';
	c: BlockNode[][]; // each item is an array of blocks
}

// OrderedList attributes: [start number, number style, delimiter style]
export type ListNumberStyle =
	| 'DefaultStyle'
	| 'Example'
	| 'Decimal'
	| 'LowerRoman'
	| 'UpperRoman'
	| 'LowerAlpha'
	| 'UpperAlpha';

export type ListNumberDelim =
	| 'DefaultDelim'
	| 'Period'
	| 'OneParen'
	| 'TwoParens';

export type ListAttributes = [number, { t: ListNumberStyle }, { t: ListNumberDelim }];

export interface OrderedListBlock extends BaseNode {
	t: 'OrderedList';
	c: [ListAttributes, BlockNode[][]];
}

export interface BlockQuoteBlock extends BaseNode {
	t: 'BlockQuote';
	c: BlockNode[];
}

export interface CodeBlockBlock extends BaseNode {
	t: 'CodeBlock';
	c: [Attr, string]; // [attr, code]
}

export interface HorizontalRuleBlock extends BaseNode {
	t: 'HorizontalRule';
}

export interface DivBlock extends BaseNode {
	t: 'Div';
	c: [Attr, BlockNode[]];
}

// Table structures
export interface TableCell {
	t: 'Cell';
	c: [Attr, { t: string }, number, number, BlockNode[]]; // [attr, alignment, rowspan, colspan, blocks]
}

export interface TableRow {
	t: 'Row';
	c: [Attr, TableCell[]];
}

export interface TableHead {
	t: 'TableHead';
	c: [Attr, TableRow[]];
}

export interface TableBody {
	t: 'TableBody';
	c: [Attr, number, TableRow[], TableRow[]]; // [attr, rowHeadColumns, headRows, bodyRows]
}

export interface TableFoot {
	t: 'TableFoot';
	c: [Attr, TableRow[]];
}

export interface ColSpec {
	t: 'ColSpec';
	c: [{ t: string }, { t: string; c?: number }]; // [alignment, width]
}

export interface TableBlock extends BaseNode {
	t: 'Table';
	c: [Attr, InlineNode[], ColSpec[], TableHead, TableBody[], TableFoot];
}

export interface RawBlock extends BaseNode {
	t: 'RawBlock';
	c: [string, string]; // [format, content]
}

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

// Meta values for document metadata
export interface MetaString {
	t: 'MetaString';
	c: string;
}

export interface MetaInlines {
	t: 'MetaInlines';
	c: InlineNode[];
}

export interface MetaBlocks {
	t: 'MetaBlocks';
	c: BlockNode[];
}

export interface MetaList {
	t: 'MetaList';
	c: MetaValue[];
}

export interface MetaMap {
	t: 'MetaMap';
	c: Record<string, MetaValue>;
}

export interface MetaBool {
	t: 'MetaBool';
	c: boolean;
}

export type MetaValue =
	| MetaString
	| MetaInlines
	| MetaBlocks
	| MetaList
	| MetaMap
	| MetaBool;

// Source info for byte offset mapping
export interface SourceInfo {
	startOffset: number; // Byte offset from start of source
	endOffset: number; // Byte offset from start of source
}

// AST context for source information
export interface ASTContext {
	files: unknown[];
	metaTopLevelKeySources: Record<string, number>;
	sourceInfoPool: SourceInfo[];
}

// Root document type
export interface QmdDocument {
	'pandoc-api-version': number[];
	meta: Record<string, MetaValue>;
	blocks: BlockNode[];
	astContext: ASTContext;
}
