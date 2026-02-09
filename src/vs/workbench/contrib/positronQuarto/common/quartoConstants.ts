/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// --- Regular expressions ---

/** Matches a plain (non-Quarto) code fence: ``` or ```language (no braces) */
export const PLAIN_FENCE_START_REGEX = /^(`{3,})(\w*)\s*$/;

// --- Cell boundary markers ---

/** HTML comment used to mark cell boundaries between consecutive markdown cells */
export const CELL_BOUNDARY_MARKER = '<!-- cell -->';

/** Regex to match cell boundary markers with surrounding whitespace */
export const CELL_MARKER_REGEX = /\s*<!-- cell -->\s*/;

// --- Language mappings ---

/** Map Quarto language identifiers to VS Code language IDs */
export const QUARTO_TO_VSCODE_LANGUAGE: Record<string, string> = {
	'ojs': 'javascript',
};

/** Map VS Code language IDs to Quarto language identifiers */
export const VSCODE_TO_QUARTO_LANGUAGE: Record<string, string> = Object.fromEntries(
	Object.entries(QUARTO_TO_VSCODE_LANGUAGE).map(([k, v]) => [v, k])
);

// --- Defaults ---

/** Default number of backticks in a code fence */
export const DEFAULT_FENCE_LENGTH = 3;

/** Notebook type identifier for Quarto notebooks */
export const QUARTO_NOTEBOOK_VIEW_TYPE = 'quarto-notebook';

// --- Cell metadata types ---

/** Quarto-specific cell metadata stored on NotebookCellData */
export interface QuartoCellMetadata {
	/** Cell type discriminator */
	type?: 'frontmatter';
	/** Code fence length (only stored when > 3) */
	fenceLength?: number;
}

/** Cell metadata with Quarto-specific properties */
export interface CellMetadataWithQuarto {
	quarto: QuartoCellMetadata;
	[key: string]: unknown;
}

/** Type guard for cells with Quarto metadata */
export function hasQuartoMetadata(meta: Record<string, unknown> | undefined): meta is CellMetadataWithQuarto {
	return meta !== null && typeof meta === 'object' && 'quarto' in meta;
}

/** Check if cell metadata indicates a YAML frontmatter cell */
export function isFrontmatterCell(meta: Record<string, unknown> | undefined): boolean {
	return hasQuartoMetadata(meta) && meta.quarto.type === 'frontmatter';
}

/** Get the code fence length for a cell, if specified in metadata */
export function getFenceLength(meta: Record<string, unknown> | undefined): number | undefined {
	return hasQuartoMetadata(meta) ? meta.quarto.fenceLength : undefined;
}

// --- Shared helpers ---

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

/**
 * Simple YAML frontmatter parser.
 * Extracts jupyter kernel specification from frontmatter.
 */
export function parseFrontmatter(frontmatterContent: string): { jupyterKernel?: string } {
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
