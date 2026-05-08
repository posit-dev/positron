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

interface MarkdownProps {
	readonly content: string;
	readonly onMermaidDoubleClick?: () => void;
	readonly onMermaidFocus?: () => void;
}

/**
 * Component that renders markdown content from a string using token-based rendering.
 * @param content: Markdown content to render in string form
 * @returns React element containing the rendered markdown.
 */
export function Markdown({ content, onMermaidDoubleClick, onMermaidFocus }: MarkdownProps) {
	const renderedHtml = useMarkdown(content, onMermaidDoubleClick, onMermaidFocus);

	switch (renderedHtml.status) {
		case 'error':
			return <div className='positron-markdown-error'>{localize('errorRenderingMd', 'Error rendering markdown:')} {renderedHtml.errorMsg}</div>;
		case 'rendering':
			return <div className='positron-markdown-rendering'>{localize('renderingMd', "Rendering markdown...")}</div>;
		case 'success':
			return <div className='positron-markdown-rendered'>{renderedHtml.nodes}</div>;
	}
}

type MarkdownRenderResults = {
	status: 'rendering';
} | {
	status: 'success';
	nodes: React.ReactElement[];
} | {
	status: 'error';
	errorMsg: string;
};

function useMarkdown(
	content: string,
	onMermaidDoubleClick: (() => void) | undefined,
	onMermaidFocus: (() => void) | undefined
): MarkdownRenderResults {

	const services = usePositronReactServicesContext();
	const [renderedHtml, setRenderedHtml] = React.useState<MarkdownRenderResults>({
		status: 'rendering'
	});

	React.useEffect(() => {
		const conversionCancellablePromise = createCancelablePromise(() => raceTimeout(
			renderNotebookMarkdown(
				content,
				services.get(IExtensionService),
				services.languageService,
				{ onMermaidDoubleClick, onMermaidFocus }
			),
			5000,
		));

		conversionCancellablePromise.then((elements) => {
			if (!Array.isArray(elements)) {
				setRenderedHtml({
					status: 'error',
					errorMsg: localize('noReactResult', 'Failed to render markdown: Invalid result returned')
				});
				return;
			}

			setRenderedHtml({
				status: 'success',
				nodes: elements
			});
		}).catch((error) => {
			setRenderedHtml({
				status: 'error',
				errorMsg: error.message
			});
		});

		return () => conversionCancellablePromise.cancel();
	}, [content, onMermaidDoubleClick, onMermaidFocus, services]);

	return renderedHtml;
}
