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
import { getWindow } from '../../../../../base/browser/dom.js';

type KatexModule = typeof import('katex').default;

let cachedKatex: KatexModule | undefined;
let katexPromise: Promise<KatexModule> | undefined;

function getKatex(): Promise<KatexModule> {
	if (!katexPromise) {
		katexPromise = importAMDNodeModule<KatexModule>('katex', 'dist/katex.min.js')
			.then(k => { cachedKatex = k; return k; });
	}
	return katexPromise;
}

function renderLatex(container: HTMLElement, katex: KatexModule, latex: string, displayMode?: boolean): void {
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
}

/**
 * Component that renders LaTeX expressions using KaTeX.
 *
 * Uses a module-level cache so that after the initial async load, all
 * subsequent renders are synchronous (no empty-frame flicker).
 */
export function KatexMath({ latex, displayMode }: { latex: string; displayMode?: boolean }) {
	const containerRef = React.useRef<HTMLSpanElement | HTMLDivElement>(null);

	React.useLayoutEffect(() => {
		const container = containerRef.current;
		if (!container) {
			return;
		}

		MarkedKatexSupport.ensureKatexStyles(getWindow(container));

		if (cachedKatex) {
			renderLatex(container, cachedKatex, latex, displayMode);
			return;
		}

		let cancelled = false;
		getKatex().then(katex => {
			if (!cancelled) {
				renderLatex(container, katex, latex, displayMode);
			}
		}).catch(() => {
			if (!cancelled && container) {
				container.textContent = latex;
			}
		});

		return () => { cancelled = true; };
	}, [latex, displayMode]);

	if (displayMode) {
		return <div ref={containerRef as React.RefObject<HTMLDivElement>} className='katex-block' />;
	}
	return <span ref={containerRef as React.RefObject<HTMLSpanElement>} className='katex-inline' />;
}
