/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './Markdown.css';

// React.
import React from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { createCancelablePromise, raceTimeout } from '../../../../../base/common/async.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { renderNotebookMarkdown } from '../markdownRenderer.js';
import { IExtensionService } from '../../../../services/extensions/common/extensions.js';
import { safeSetInnerHtml } from '../../../../../base/browser/domSanitize.js';
import { allowedMarkdownHtmlTags, allowedMarkdownHtmlAttributes } from '../../../../../base/browser/markdownRenderer.js';
import { MarkedKatexSupport } from '../../../markdown/browser/markedKatexSupport.js';

/**
 * Component that render markdown content from a string.
 * @param content: Markdown content to render in string form
 * @returns React element containing the rendered markdown.
 */
export function Markdown({ content }: { content: string }) {

	const renderedHtml = useMarkdown(content);

	switch (renderedHtml.status) {
		case 'error':
			return <div className='positron-markdown-error'>{localize('errorRenderingMd', 'Error rendering markdown:')} {renderedHtml.errorMsg}</div>;
		case 'rendering':
			return <div className='positron-markdown-rendering' >{localize('renderingMd', "Rendering markdown...")}</div>;
		case 'success':
			return <div className='positron-markdown-rendered'>{renderedHtml.nodes}</div>;
	}
}

type MarkdownRenderResults = {
	status: 'rendering';
} | {
	status: 'success';
	nodes: React.ReactElement;
} | {
	status: 'error';
	errorMsg: string;
};

function useMarkdown(content: string): MarkdownRenderResults {

	const services = usePositronReactServicesContext();
	const [renderedHtml, setRenderedHtml] = React.useState<MarkdownRenderResults>({
		status: 'rendering'
	});

	React.useEffect(() => {

		const conversionCancellablePromise = createCancelablePromise(() => raceTimeout(
			renderNotebookMarkdown(content, services.get(IExtensionService), services.languageService),
			5000,
		));

		conversionCancellablePromise.then((html) => {
			if (typeof html !== 'string') {
				setRenderedHtml({
					status: 'error',
					errorMsg: localize('noHtmlResult', 'Failed to render markdown: No HTML result returned')
				});
				return;
			}
			setRenderedHtml({
				status: 'success',
				nodes: <MarkdownContent html={html} />
			});
		}).catch((error) => {
			setRenderedHtml({
				status: 'error',
				errorMsg: error.message
			});
		});

		return () => conversionCancellablePromise.cancel();
	}, [content, services]);

	return renderedHtml;
}

/**
 * Component that uses `domSanitize.safeSetInnerHtml` to render HTML.
 * Uses MarkedKatexSupport.getSanitizerOptions() to get the appropriate sanitizer configuration
 * that includes MathML and SVG tags/attributes required for KaTeX math rendering.
 *
 * This approach matches the chat pane markdown rendering approach.
 *
 * @param html: HTML string to render
 * @returns React element containing the sanitized HTML.
 */
function MarkdownContent({ html }: { html: string }) {
	const containerRef = React.useRef<HTMLDivElement>(null);

	React.useEffect(() => {
		if (containerRef.current) {
			// Use MarkedKatexSupport helper to get sanitizer config with MathML/SVG support
			const sanitizerConfig = MarkedKatexSupport.getSanitizerOptions({
				allowedTags: allowedMarkdownHtmlTags,
				allowedAttributes: allowedMarkdownHtmlAttributes,
			});

			safeSetInnerHtml(containerRef.current, html, sanitizerConfig);
		}
	}, [html]);

	return <div ref={containerRef} />;
}
