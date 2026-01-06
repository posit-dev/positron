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
import { DomSanitizerConfig, safeSetInnerHtml } from '../../../../../base/browser/domSanitize.js';
import { allowedMarkdownHtmlTags, allowedMarkdownHtmlAttributes } from '../../../../../base/browser/markdownRenderer.js';
import { MarkedKatexSupport } from '../../../markdown/browser/markedKatexSupport.js';
import { convertDomChildrenToReact } from '../domToReact.js';
import { DeferredImage } from './DeferredImage.js';
import { NotebookLink } from './NotebookLink.js';

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

			// Render using MarkdownContent which uses DOMPurify sanitization with React component overrides
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
 * Component that renders HTML with proper sanitization (via DOMPurify through safeSetInnerHtml)
 * and support for React component overrides.
 *
 * Since React's dangerouslySetInnerHTML doesn't allow component overrides, we go through the following steps:
 * HTML string -> Hidden DOM node (sanitized via DOMPurify) -> React tree -> Rendered DOM node
 *
 * This allows us to:
 * 1. Sanitize untrusted HTML safely (including complex KaTeX math output with MathML/SVG)
 * 2. Replace specific tags with custom React components (DeferredImage for lazy loading, NotebookLink for navigation)
 * 3. Maintain full React lifecycle and behavior for those components
 *
 * @param html: HTML string to render
 * @returns React element containing the sanitized and converted HTML.
 */
function MarkdownContent({ html }: { html: string }) {
	const reactElements = React.useMemo(() => {
		// Use MarkedKatexSupport helper to get sanitizer config options
		// for MathML/SVG support.
		const sanitizerConfig = MarkedKatexSupport.getSanitizerOptions({
			allowedTags: allowedMarkdownHtmlTags,
			allowedAttributes: [
				...allowedMarkdownHtmlAttributes,
				'id'  // Allow id attribute for anchor link targets
			],
		});

		// Configure to allow relative paths for images and local links.
		// This is critical for notebook markdown which uses relative image paths
		const notebookSanitizerConfig = {
			...sanitizerConfig,
			allowedLinkProtocols: {
				override: ['http', 'https'] as readonly string[]
			},
			allowedMediaProtocols: {
				override: ['http', 'https', 'data'] as readonly string[]
			},
			allowRelativeLinkPaths: true,
			allowRelativeMediaPaths: true
		};

		// Sanitize HTML into a temporary container element
		const tempContainer = sanitizeHtmlToElement(html, notebookSanitizerConfig);
		// Convert the DOM tree to React elements with component overrides
		return convertDomChildrenToReact(
			tempContainer,
			{
				img: DeferredImage,  // Enable local image conversion and remote SVG handling
				a: NotebookLink,     // Enable proper link handling and anchor navigation
			}
		);
	}, [html]);

	return <>{reactElements}</>;
}

/**
 * Sanitizes HTML string into a dom element.
 *
 * @param html - HTML string to sanitize
 * @param config - DOMPurify sanitizer configuration options
 * @returns A div element containing the sanitized HTML content
 */
function sanitizeHtmlToElement(html: string, config: DomSanitizerConfig): HTMLDivElement {
	// Create a temporary container that holds the sanitized HTML
	const tempContainer = document.createElement('div');
	// Render HTML with DOMPurify sanitization into the temp container
	safeSetInnerHtml(tempContainer, html, config);
	return tempContainer;
}
