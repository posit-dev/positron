/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// React.
import React from 'react';

// Other dependencies.
import { importAMDNodeModule } from '../../../../../amdX.js';
import { safeSetInnerHtml } from '../../../../../base/browser/domSanitize.js';
import { allowedMarkdownHtmlTags, allowedMarkdownHtmlAttributes } from '../../../../../base/browser/markdownRenderer.js';
import { MarkedKatexSupport } from '../../../markdown/browser/markedKatexSupport.js';

/**
 * Component that renders LaTeX expressions using KaTeX.
 *
 * Loads KaTeX dynamically, renders the LaTeX string to HTML/MathML/SVG,
 * then sanitizes and injects it into the container element.
 * Falls back to displaying the raw LaTeX text on error.
 *
 * @param latex The raw LaTeX string to render
 * @param displayMode Whether to render in display mode (block) or inline mode (default)
 */
export function KatexMath({ latex, displayMode }: { latex: string; displayMode?: boolean }) {
	const containerRef = React.useRef<HTMLSpanElement | HTMLDivElement>(null);

	React.useEffect(() => {
		const container = containerRef.current;
		if (!container) {
			return;
		}

		let cancelled = false;

		importAMDNodeModule<typeof import('katex').default>('katex', 'dist/katex.min.js').then(katex => {
			if (cancelled) {
				return;
			}

			try {
				const html = katex.renderToString(latex, {
					throwOnError: false,
					displayMode: displayMode || false
				});
				const sanitizerConfig = MarkedKatexSupport.getSanitizerOptions({
					allowedTags: allowedMarkdownHtmlTags,
					allowedAttributes: allowedMarkdownHtmlAttributes,
				});
				safeSetInnerHtml(container, html, sanitizerConfig);
			} catch {
				container.textContent = latex;
			}
		}).catch(() => {
			if (!cancelled && container) {
				container.textContent = latex;
			}
		});

		return () => {
			cancelled = true;
		};
	}, [latex, displayMode]);

	if (displayMode) {
		return <div ref={containerRef as React.RefObject<HTMLDivElement>} className='katex-block' />;
	}
	return <span ref={containerRef as React.RefObject<HTMLSpanElement>} className='katex-inline' />;
}
