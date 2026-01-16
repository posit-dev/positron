/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './markdownContent.css';

// React.
import React from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { createCancelablePromise, raceTimeout } from '../../../../../base/common/async.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { renderNotebookMarkdown } from '../markdownRenderer.js';
import { IExtensionService } from '../../../../services/extensions/common/extensions.js';

/**
 * Component that renders markdown content from a string using token-based rendering.
 * @param content: Markdown content to render in string form
 * @returns React element containing the rendered markdown.
 */
export function Markdown({ content }: { content: string }) {
	const renderedHtml = useMarkdown(content);

	switch (renderedHtml.status) {
		case 'error':
			return <div className='positron-markdown-content-error'>{localize('errorRenderingMd', 'Error rendering markdown:')} {renderedHtml.errorMsg}</div>;
		case 'rendering':
			return <div className='positron-markdown-content-rendering'>{localize('renderingMd', "Rendering markdown...")}</div>;
		case 'success':
			return <div className='positron-markdown-content'>{renderedHtml.nodes}</div>;
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

function useMarkdown(content: string): MarkdownRenderResults {

	const services = usePositronReactServicesContext();
	const [renderedHtml, setRenderedHtml] = React.useState<MarkdownRenderResults>({
		status: 'rendering'
	});

	React.useEffect(() => {
		const conversionCancellablePromise = createCancelablePromise(() => raceTimeout(
			renderNotebookMarkdown(
				content,
				services.get(IExtensionService),
				services.languageService
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
	}, [content, services]);

	return renderedHtml;
}
