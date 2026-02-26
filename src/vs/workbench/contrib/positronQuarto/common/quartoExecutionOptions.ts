/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { parse as parseYaml, YamlObjectNode } from '../../../../base/common/yaml.js';

/**
 * Execution options parsed from cell YAML comments.
 * These are Quarto-specific options that control cell execution behavior.
 */
export interface QuartoCellExecutionOptions {
	/**
	 * Whether to evaluate the cell.
	 * Default: true
	 *
	 * When false and multiple cells are passed to executeInlineCells,
	 * the cell is silently dropped from the queue.
	 * When false and it's the ONLY cell passed, it executes anyway.
	 */
	readonly eval: boolean;

	/**
	 * Whether errors should stop execution of subsequent cells.
	 * Default: true (stop on error)
	 *
	 * When true and an error occurs, remaining cells in the queue are removed.
	 * When false, errors are non-fatal and the queue continues processing.
	 */
	readonly error: boolean;
}

/**
 * Default cell execution options.
 */
export const DEFAULT_CELL_EXECUTION_OPTIONS: QuartoCellExecutionOptions = {
	eval: true,
	error: true,
};

/**
 * Regex to match Quarto option lines: optional whitespace + #| + optional whitespace + content
 * Examples:
 *   #| eval: false
 *   #|eval: true
 *     #| error: false
 */
const OPTION_LINE_REGEX = /^\s*#\|\s?(.*)$/;

/**
 * Result of parsing cell execution options.
 */
export interface ParsedCellOptions {
	/** The parsed execution options */
	options: QuartoCellExecutionOptions;
	/** Number of option lines at the start of the code */
	optionLineCount: number;
}

/**
 * Parse execution options from cell code content.
 *
 * Quarto cells can specify execution options using YAML-style comments at the top of the cell:
 * ```{python}
 * #| eval: true
 * #| error: false
 *
 * statements...
 * ```
 *
 * Lines beginning with optional whitespace followed by `#|` are option lines.
 * These are parsed as YAML (after stripping the `#|` prefix).
 *
 * @param code The full cell code (including any option lines)
 * @returns Parsed options and the number of option lines at the start
 */
export function parseCellExecutionOptions(code: string): ParsedCellOptions {
	const lines = code.split('\n');
	const optionLines: string[] = [];
	let optionLineCount = 0;

	// Collect all leading option lines
	for (const line of lines) {
		const match = line.match(OPTION_LINE_REGEX);
		if (match) {
			optionLines.push(match[1]);
			optionLineCount++;
		} else {
			// Stop at first non-option line
			break;
		}
	}

	// Start with defaults
	const options: QuartoCellExecutionOptions = { ...DEFAULT_CELL_EXECUTION_OPTIONS };

	if (optionLines.length > 0) {
		// Parse accumulated option lines as YAML
		const yamlContent = optionLines.join('\n');
		const errors: import('../../../../base/common/yaml.js').YamlParseError[] = [];
		const parsed = parseYaml(yamlContent, errors);

		if (parsed && parsed.type === 'object') {
			const obj = parsed as YamlObjectNode;
			for (const prop of obj.properties) {
				const key = prop.key.value;
				const value = prop.value;

				if (key === 'eval' && value.type === 'boolean') {
					(options as { eval: boolean }).eval = value.value;
				}
				if (key === 'error' && value.type === 'boolean') {
					(options as { error: boolean }).error = value.value;
				}
			}
		}
	}

	return { options, optionLineCount };
}

/**
 * Extract just the executable code from cell content, removing option lines.
 *
 * @param code The full cell code (including any option lines)
 * @returns The code with option lines removed
 */
export function extractExecutableCode(code: string): string {
	const { optionLineCount } = parseCellExecutionOptions(code);
	const lines = code.split('\n');
	return lines.slice(optionLineCount).join('\n');
}

/**
 * Get the number of option lines at the start of the code.
 * This is useful for calculating effective code ranges.
 *
 * @param code The full cell code (including any option lines)
 * @returns The number of option lines
 */
export function getOptionLineCount(code: string): number {
	const { optionLineCount } = parseCellExecutionOptions(code);
	return optionLineCount;
}
