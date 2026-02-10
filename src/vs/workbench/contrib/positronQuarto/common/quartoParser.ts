/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILogService } from '../../../../platform/log/common/log.js';
import {
	QuartoNodeType,
	QuartoSourceLocation,
	QuartoCodeBlock,
	QuartoRawBlock,
	QuartoFrontmatter,
	QuartoDocument,
} from './quartoTypes.js';

// --- Regular expressions for parsing Quarto documents ---

/** Matches YAML frontmatter block at the start of a document */
const FRONTMATTER_REGEX = /^---\r?\n(?<content>[\s\S]*?)\r?\n---/;

/** Matches the opening fence of a code block: ```{language options} */
const CODE_START_REGEX = /^```\{(?<language>\w+)(?<options>[^}]*)\}\s*$/;

/** Matches the opening fence of a raw block: ```{=format} */
const RAW_START_REGEX = /^```\{=(?<format>\w+)\}\s*$/;

/** Matches a closing code fence. */
const CODE_END_REGEX = /^```\s*$/;

// --- Helpers ---

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
 * Simple YAML frontmatter parser.
 * Extracts jupyter kernel specification from frontmatter.
 */
function parseFrontmatter(frontmatterContent: string): { jupyterKernel?: string } {
	const result: { jupyterKernel?: string } = {};

	// Look for jupyter: kernel_name or jupyter:\n  kernelspec:\n    name: kernel_name
	const lines = frontmatterContent.split(/\r?\n/);

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Check for simple form: jupyter: python3
		const simpleMatch = line.match(/^jupyter:\s*(\S+)\s*$/);
		if (simpleMatch) {
			result.jupyterKernel = simpleMatch[1];
			break;
		}

		// Check for complex form: jupyter:
		if (/^jupyter:\s*$/.test(line)) {
			// Look for kernelspec in subsequent lines
			for (let j = i + 1; j < lines.length; j++) {
				const subLine = lines[j];
				// If we hit a non-indented line, stop searching
				if (subLine.match(/^\S/)) {
					break;
				}
				// Look for kernelspec:
				if (/^\s+kernelspec:\s*$/.test(subLine)) {
					// Look for name in subsequent lines
					for (let k = j + 1; k < lines.length; k++) {
						const kernelLine = lines[k];
						// If we hit a line with less indentation, stop
						if (kernelLine.match(/^\s{0,3}\S/)) {
							break;
						}
						const nameMatch = kernelLine.match(/^\s+name:\s*(\S+)/);
						if (nameMatch) {
							result.jupyterKernel = nameMatch[1];
							break;
						}
					}
					break;
				}
			}
			break;
		}
	}

	return result;
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
export function parseQuarto(content: string, logService?: ILogService): QuartoDocument {
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
			begin: { line: 0 },
			end: { line: frontmatterLineCount - 1 },
		};
		frontmatter = { rawContent, jupyterKernel, location };
		lineIndex = frontmatterLineCount;
	}

	// Step 2: Scan for code blocks and raw blocks.
	let current: OpenBlock | null = null;

	for (let i = lineIndex; i < lines.length; i++) {
		const line = lines[i];
		const lineNum = i; // 0-based line index

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
			const content = lines.slice(current.startLine + 1, lineNum).join('\n');
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
}// --- Shared helpers ---
/**
 * Maps common Jupyter kernel names to language identifiers.
 */

export function kernelToLanguageId(kernelName: string): string | undefined {
	const kernelLower = kernelName.toLowerCase();
	if (kernelLower.includes('python')) {
		return 'python';
	}
	if (kernelLower.includes('ir') || kernelLower === 'r') {
		return 'r';
	}
	if (kernelLower.includes('julia')) {
		return 'julia';
	}
	return undefined;
}

