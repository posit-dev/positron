/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { StringSHA1 } from '../../../../base/common/hash.js';
import {
	FRONTMATTER_REGEX,
	CHUNK_START_REGEX,
	RAW_BLOCK_START_REGEX,
	parseFrontmatter,
	kernelToLanguageId,
	DEFAULT_FENCE_LENGTH,
} from './quartoConstants.js';

// --- Types ---

/**
 * Currently parsed node types. Add more as needed.
 */
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

	// TODO: Remove contentHash and have callers calculate from content
	/** SHA-1 hash of node content (first 16 chars). */
	readonly contentHash: string;

	/** Number of backticks in the fence (only tracked when > 3). */
	// TODO: Can caller also deal with this?
	readonly fenceLength?: number;
}

/** Executable code block */
export interface QuartoCodeBlock extends QuartoNode {
	readonly type: QuartoNodeType.CodeBlock;

	/** Stable ID: "{index}-{hashPrefix}-{label|unlabeled}" */
	// TODO: Consider lifting ID to caller
	readonly id: string;

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

	/** 1-based line number where frontmatter ends (the closing ---). */
	// TODO: Replace with location?
	readonly endLine: number;
}

/**
 * Parsed QMD document.
 */
export interface QuartoDocument {
	/** All parsed blocks, ordered by position. */
	readonly blocks: readonly QuartoNode[];

	/** Frontmatter, if present. */
	readonly frontmatter?: QuartoFrontmatter;

	/** Primary language (from frontmatter kernel or first code block). */
	readonly primaryLanguage?: string;

	/** The document split into lines (for extracting content by line range). */
	readonly lines: readonly string[];
}

// --- Helpers ---

/**
 * Computes a SHA-1 hash of the content, truncated to 16 characters.
 */
function computeContentHash(content: string): string {
	const sha = new StringSHA1();
	sha.update(content);
	return sha.digest().substring(0, 16);
}

/**
 * Generates a stable block ID from index, content hash, and label.
 * Format: "{index}-{hashPrefix}-{label|unlabeled}"
 */
function generateBlockId(index: number, contentHash: string, label: string | undefined): string {
	const hashPrefix = contentHash.substring(0, 8);
	const labelPart = label || 'unlabeled';
	return `${index}-${hashPrefix}-${labelPart}`;
}

/**
 * Extracts the block label from chunk options.
 * The label is the first option if it doesn't contain '='.
 */
function extractLabel(options: string): string | undefined {
	if (!options) {
		return undefined;
	}
	const firstOption = options.split(',')[0].trim();
	if (firstOption && !firstOption.includes('=')) {
		return firstOption;
	}
	return undefined;
}

/**
 * Check if a line is a closing fence that matches the opening fence length.
 */
function isClosingFence(line: string, openingLength: number): boolean {
	const match = line.match(/^(`{3,})\s*$/);
	return match !== null && match[1].length >= openingLength;
}

// --- Parser ---

/**
 * Parse a QMD document into blocks and frontmatter.
 *
 * Recognizes:
 * - Quarto code blocks: ```{language options}
 * - Raw blocks: ```{=format}
 *
 * Plain code fences (``` or ```lang without braces) are treated as
 * markdown content, not blocks.
 */
export function parseQuartoDocument(content: string): QuartoDocument {
	if (!content) {
		return { blocks: [], lines: [] };
	}

	const lines = content.split(/\r?\n/);
	const blocks: (QuartoCodeBlock | QuartoRawBlock)[] = [];
	let frontmatter: QuartoFrontmatter | undefined;
	let primaryLanguage: string | undefined;
	let lineIndex = 0;
	let blockIndex = 0;

	// Step 1: Extract frontmatter
	const frontmatterMatch = content.match(FRONTMATTER_REGEX);
	if (frontmatterMatch) {
		const rawContent = frontmatterMatch[0];
		const frontmatterLineCount = rawContent.split(/\r?\n/).length;
		let jupyterKernel: string | undefined;

		try {
			const parsed = parseFrontmatter(frontmatterMatch[1]);
			jupyterKernel = parsed.jupyterKernel;
			if (jupyterKernel) {
				primaryLanguage = kernelToLanguageId(jupyterKernel);
			}
		} catch {
			// Ignore frontmatter parse errors
		}

		frontmatter = { rawContent, jupyterKernel, endLine: frontmatterLineCount };
		lineIndex = frontmatterLineCount;
	}

	// Step 2: Scan for code blocks and raw blocks.
	// Mutable state tracked while a block is open.
	interface OpenCodeBlock {
		type: QuartoNodeType.CodeBlock;
		fenceLength: number;
		language: string;
		options: string;
		startLine: number;
	}

	interface OpenRawBlock {
		type: QuartoNodeType.RawBlock;
		fenceLength: number;
		format: string;
		startLine: number;
	}

	type OpenBlock = OpenCodeBlock | OpenRawBlock;

	function finalizeBlock(open: OpenBlock, endLine: number, hasFence: boolean): void {
		const contentStart = open.startLine + 1;
		const contentEnd = hasFence ? endLine - 1 : endLine;

		let text = '';
		if (contentEnd >= contentStart) {
			text = lines.slice(contentStart - 1, contentEnd).join('\n');
		}
		const contentHash = computeContentHash(text);
		const storedFenceLength = open.fenceLength > DEFAULT_FENCE_LENGTH
			? open.fenceLength : undefined;

		const location: QuartoSourceLocation = { begin: { line: open.startLine }, end: { line: endLine } };
		const base = { location, contentHash, fenceLength: storedFenceLength };

		if (open.type === QuartoNodeType.CodeBlock) {
			const label = extractLabel(open.options);
			blocks.push({
				...base,
				type: QuartoNodeType.CodeBlock,
				id: generateBlockId(blockIndex, contentHash, label),
				content: text,
				language: open.language,
				label,
				options: open.options,
			});
		} else {
			blocks.push({
				...base,
				type: QuartoNodeType.RawBlock,
				content: text,
				format: open.format,
			});
		}

		blockIndex++;
	}

	let current: OpenBlock | null = null;

	for (let i = lineIndex; i < lines.length; i++) {
		const line = lines[i];
		const lineNum = i + 1; // 1-based

		if (!current) {
			const chunkMatch = line.match(CHUNK_START_REGEX);
			if (chunkMatch) {
				current = {
					type: QuartoNodeType.CodeBlock,
					fenceLength: chunkMatch[1].length,
					language: chunkMatch[2].toLowerCase(),
					options: chunkMatch[3].trim(),
					startLine: lineNum,
				};
				continue;
			}

			const rawMatch = line.match(RAW_BLOCK_START_REGEX);
			if (rawMatch) {
				current = {
					type: QuartoNodeType.RawBlock,
					fenceLength: rawMatch[1].length,
					format: rawMatch[2].toLowerCase(),
					startLine: lineNum,
				};
			}
		} else if (isClosingFence(line, current.fenceLength)) {
			finalizeBlock(current, lineNum, true);
			current = null;
		}
	}

	// Handle unclosed block at end of document
	if (current) {
		finalizeBlock(current, lines.length, false);
	}

	// Step 3: Determine primary language from first code block if not from frontmatter
	if (!primaryLanguage) {
		const firstCode = blocks.find((b): b is QuartoCodeBlock => b.type === QuartoNodeType.CodeBlock);
		if (firstCode) {
			primaryLanguage = firstCode.language;
		}
	}

	return { blocks, frontmatter, primaryLanguage, lines };
}
