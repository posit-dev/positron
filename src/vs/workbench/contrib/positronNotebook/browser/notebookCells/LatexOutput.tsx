/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './LatexOutput.css';

// React.
import React from 'react';

// Other dependencies.
import { importAMDNodeModule } from '../../../../../amdX.js';
import { getWindow } from '../../../../../base/browser/dom.js';
import { safeSetInnerHtml } from '../../../../../base/browser/domSanitize.js';
import { allowedMarkdownHtmlTags, allowedMarkdownHtmlAttributes } from '../../../../../base/browser/markdownRenderer.js';
import { MarkedKatexSupport } from '../../../markdown/browser/markedKatexSupport.js';
import { normalizeLatex } from './normalizeLatex.js';

/**
 * Renders `text/latex` MIME output using KaTeX.
 *
 * Strips math-mode delimiters (since the MIME type already signals the content
 * is LaTeX) and renders in display mode (block-level math).
 */
export function LatexOutput({ content }: { content: string }) {
	const containerRef = React.useRef<HTMLDivElement>(null);

	React.useEffect(() => {
		const container = containerRef.current;
		if (!container) {
			return;
		}

		let cancelled = false;

		const latex = normalizeLatex(content);

		MarkedKatexSupport.ensureKatexStyles(getWindow(container));

		importAMDNodeModule<typeof import('katex').default>('katex', 'dist/katex.min.js').then(katex => {
			if (cancelled) {
				return;
			}

			try {
				const html = katex.renderToString(latex, {
					throwOnError: false,
					displayMode: true,
				});
				const sanitizerConfig = MarkedKatexSupport.getSanitizerOptions({
					allowedTags: allowedMarkdownHtmlTags,
					allowedAttributes: allowedMarkdownHtmlAttributes,
				});
				safeSetInnerHtml(container, html, sanitizerConfig);
			} catch {
				container.textContent = content;
			}
		}).catch(() => {
			if (!cancelled && container) {
				container.textContent = content;
			}
		});

		return () => {
			cancelled = true;
		};
	}, [content]);

	return <div ref={containerRef} className='positron-notebook-latex-output' />;
}
