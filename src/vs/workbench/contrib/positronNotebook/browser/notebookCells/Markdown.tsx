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
 * Component that renders HTML with proper DOMPurify sanitization and React component overrides.
 *
 * This implementation:
 * 1. Uses safeSetInnerHtml with MarkedKatexSupport config to handle complex KaTeX math rendering
 * 2. Converts the sanitized DOM to React elements using convertDomChildrenToReact
 * 3. Injects React component overrides for images (DeferredImage) and links (NotebookLink)
 *
 * @param html: HTML string to render
 * @returns React element containing the sanitized and converted HTML.
 */
function MarkdownContent({ html }: { html: string }) {
	const [reactElements, setReactElements] = React.useState<React.ReactElement[]>([]);

	React.useEffect(() => {
		// Create a temporary container for DOM parsing
		const tempContainer = document.createElement('div');

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

		// Render HTML with DOMPurify sanitization
		safeSetInnerHtml(tempContainer, html, notebookSanitizerConfig);

		// Convert the DOM tree to React elements with component overrides
		const elements = convertDomChildrenToReact(
			tempContainer,
			{
				img: DeferredImage,  // Enable local image conversion and remote SVG handling
				a: NotebookLink,     // Enable proper link handling and anchor navigation
			}
		);

		setReactElements(elements);
	}, [html]);

	return <>{reactElements}</>;
}
