/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Normalizes LaTeX content from `text/latex` MIME outputs for direct KaTeX rendering.
 *
 * Content from `text/latex` MIME may arrive with various delimiter styles depending on source:
 * - IPython.display.Math: wraps in `$...$` or `\(...\)`
 * - IPython.display.Latex: raw LaTeX environments like `\begin{align}...`
 * - Raw mimebundles: arbitrary combinations including `$...$` fragments
 *
 * Since the MIME type already signals the content is LaTeX, all `$` delimiter pairs are
 * redundant. KaTeX cannot parse `$` in math mode, so we strip them.
 */
export function normalizeLatex(content: string): string {
	const trimmed = content.trim();

	// Strip outer \[...\] (display math)
	if (trimmed.startsWith('\\[') && trimmed.endsWith('\\]')) {
		return trimmed.slice(2, -2).trim();
	}

	// Strip outer \(...\) (inline math)
	if (trimmed.startsWith('\\(') && trimmed.endsWith('\\)')) {
		return trimmed.slice(2, -2).trim();
	}

	// Strip all $ delimiters (both $...$ and $$...$$) since the MIME type
	// already establishes math context. KaTeX errors on literal $ in math mode.
	return trimmed.replace(/\${1,2}/g, '').trim();
}
