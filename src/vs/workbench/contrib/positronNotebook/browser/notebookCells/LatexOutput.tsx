/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './LatexOutput.css';

// React.
import React from 'react';

// Other dependencies.
import { KatexMath } from './KatexMath.js';
import { normalizeLatex } from './normalizeLatex.js';

/**
 * Renders `text/latex` MIME output using KaTeX.
 *
 * Strips math-mode delimiters (since the MIME type already signals the content
 * is LaTeX) and renders in display mode (block-level math).
 */
export function LatexOutput({ content }: { content: string }) {
	const latex = React.useMemo(() => normalizeLatex(content), [content]);

	return (
		<div className='positron-notebook-latex-output'>
			<KatexMath displayMode latex={latex} />
		</div>
	);
}
