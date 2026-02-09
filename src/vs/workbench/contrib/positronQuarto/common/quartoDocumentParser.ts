/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILogService } from '../../../../platform/log/common/log.js';
import { parseFrontmatter } from './quartoConstants.js';

// --- Regular expressions for parsing Quarto documents ---

/** Matches YAML frontmatter block at the start of a document */
export const FRONTMATTER_REGEX = /^---\r?\n(?<content>[\s\S]*?)\r?\n---/;

/** Matches the opening fence of a code block: ```{language options} */
export const CODE_START_REGEX = /^```\{(?<language>\w+)(?<options>[^}]*)\}\s*$/;

/** Matches the opening fence of a raw block: ```{=format} */
export const RAW_START_REGEX = /^```\{=(?<format>\w+)\}\s*$/;

/** Matches a closing code fence. */
export const CODE_END_REGEX = /^```\s*$/;

// --- Types ---

/** Currently parsed node types. Add more as needed. */
export const enum QuartoNodeType {
	CodeBlock = 'CodeBlock',
	RawBlock = 'RawBlock',
}

/** Source position within a file */
export interface QuartoSourcePosition {
	/** Line number (1-indexed) */
	line: number;
}

/** Source location span */
export interface QuartoSourceLocation {
	/** Beginning position */
	readonly begin: QuartoSourcePosition;

	/** Ending position */
	readonly end: QuartoSourcePosition;
}

/** Base node */
export interface QuartoNode {
	/** Node type discriminator. */
	readonly type: QuartoNodeType;

	/** Source location in the document. */
	readonly location: QuartoSourceLocation;
}

/** Executable code block */
export interface QuartoCodeBlock extends QuartoNode {
	readonly type: QuartoNodeType.CodeBlock;

	/** Content of the code block. */
	readonly content: string;

	/** Language from the opening fence (lowercased). */
	readonly language: string;

	/** Optional label (first option if it doesn't contain '='). */
	readonly label?: string;

	/** Raw options string from the chunk header (trimmed). */
	readonly options: string;
}

/** Raw content in a specific format (e.g., HTML, LaTeX) */
export interface QuartoRawBlock extends QuartoNode {
	readonly type: QuartoNodeType.RawBlock;

	/** Content of the raw block. */
	readonly content: string;

	/** Format identifier from the opening fence (lowercased). */
	readonly format: string;
}

/** Document frontmatter metadata */
export interface QuartoFrontmatter {
	/** Raw frontmatter text including --- delimiters. */
	readonly rawContent: string;

	/** Extracted Jupyter kernel name, if present. */
	readonly jupyterKernel?: string;

	/** Source location spanning the frontmatter block. */
	readonly location: QuartoSourceLocation;
}

/**
 * Parsed QMD document.
 */
export interface QuartoDocument {
	/** All parsed blocks, ordered by position. */
	readonly blocks: readonly QuartoNode[];

	/** Frontmatter, if present. */
	readonly frontmatter?: QuartoFrontmatter;

	/** The document split into lines (for extracting content by line range). */
	readonly lines: readonly string[];
}

// --- Helpers ---

/**
 * Extracts the block label from chunk options.
 * The label is the first option if it doesn't contain '='.
 */
export function extractLabel(options: string): string | undefined {
	if (!options) {
		return undefined;
	}
	const firstOption = options.split(',')[0].trim();
	if (firstOption && !firstOption.includes('=')) {
		return firstOption;
	}
	return undefined;
}


// --- Parser internals ---

/** Mutable state tracked while a code block is open. */
interface OpenCodeBlock {
	type: QuartoNodeType.CodeBlock;
	language: string;
	options: string;
	startLine: number;
}

/** Mutable state tracked while a raw block is open. */
interface OpenRawBlock {
	type: QuartoNodeType.RawBlock;
	format: string;
	startLine: number;
}

type OpenBlock = OpenCodeBlock | OpenRawBlock;

// --- Parser ---

/**
 * Parse a QMD document.
 */
export function parseQuartoDocument(content: string, logService?: ILogService): QuartoDocument {
	if (!content) {
		return { blocks: [], lines: [] };
	}

	const lines = content.split(/\r?\n/);
	const blocks: (QuartoCodeBlock | QuartoRawBlock)[] = [];
	let frontmatter: QuartoFrontmatter | undefined;
	let lineIndex = 0;

	// Step 1: Extract frontmatter
	const frontmatterMatch = content.match(FRONTMATTER_REGEX);
	if (frontmatterMatch?.groups) {
		const rawContent = frontmatterMatch[0];
		const frontmatterLineCount = rawContent.split(/\r?\n/).length;
		let jupyterKernel: string | undefined;

		try {
			const parsed = parseFrontmatter(frontmatterMatch.groups.content);
			jupyterKernel = parsed.jupyterKernel;
		} catch (e) {
			logService?.warn('Failed to parse Quarto frontmatter', e);
		}

		const location: QuartoSourceLocation = {
			begin: { line: 1 },
			end: { line: frontmatterLineCount },
		};
		frontmatter = { rawContent, jupyterKernel, location };
		lineIndex = frontmatterLineCount;
	}

	// Step 2: Scan for code blocks and raw blocks.
	let current: OpenBlock | null = null;

	for (let i = lineIndex; i < lines.length; i++) {
		const line = lines[i];
		const lineNum = i + 1; // 1-based

		if (!current) {
			const codeBlock = line.match(CODE_START_REGEX)?.groups;
			if (codeBlock) {
				current = {
					type: QuartoNodeType.CodeBlock,
					language: codeBlock.language.toLowerCase(),
					options: codeBlock.options.trim(),
					startLine: lineNum,
				};
				continue;
			}

			const rawBlock = line.match(RAW_START_REGEX)?.groups;
			if (rawBlock) {
				current = {
					type: QuartoNodeType.RawBlock,
					format: rawBlock.format.toLowerCase(),
					startLine: lineNum,
				};
			}
		} else if (CODE_END_REGEX.test(line)) {
			const content = lines.slice(current.startLine, lineNum - 1).join('\n');
			const location: QuartoSourceLocation = {
				begin: { line: current.startLine },
				end: { line: lineNum },
			};
			if (current.type === QuartoNodeType.CodeBlock) {
				blocks.push({
					type: QuartoNodeType.CodeBlock,
					location,
					content,
					language: current.language,
					label: extractLabel(current.options),
					options: current.options,
				});
			} else {
				blocks.push({
					type: QuartoNodeType.RawBlock,
					location,
					content,
					format: current.format,
				});
			}
			current = null;
		}
	}

	return { blocks, frontmatter, lines };
}
