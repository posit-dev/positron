/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Token-based Markdown Cell Renderer
 *
 * Alternative implementation of Markdown.tsx that uses token-based rendering
 * instead of HTML → DOM → React conversion.
 *
 * To test this approach, temporarily replace imports in the notebook component.
 */

// CSS.
import '../notebookCells/Markdown.css';

// React.
import React from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { createCancelablePromise, raceTimeout } from '../../../../../base/common/async.js';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { renderNotebookMarkdownTokens } from '../tokenMarkdownRenderer.js';
import { IExtensionService } from '../../../../services/extensions/common/extensions.js';

/**
 * Component that renders markdown content from a string using token-based rendering.
 * @param content: Markdown content to render in string form
 * @returns React element containing the rendered markdown.
 */
export function MarkdownToken({ content }: { content: string }) {
	const renderedMarkdown = useTokenMarkdown(content);

	switch (renderedMarkdown.status) {
		case 'error':
			return <div className='positron-markdown-error'>
				{localize('errorRenderingMd', 'Error rendering markdown:')} {renderedMarkdown.errorMsg}
			</div>;
		case 'rendering':
			return <div className='positron-markdown-rendering'>
				{localize('renderingMd', "Rendering markdown...")}
			</div>;
		case 'success':
			return <div className='positron-markdown-rendered'>{renderedMarkdown.nodes}</div>;
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

function useTokenMarkdown(content: string): MarkdownRenderResults {
	const services = usePositronReactServicesContext();
	const [renderedMarkdown, setRenderedMarkdown] = React.useState<MarkdownRenderResults>({
		status: 'rendering'
	});

	React.useEffect(() => {
		const conversionCancellablePromise = createCancelablePromise(() => raceTimeout(
			renderNotebookMarkdownTokens(
				content,
				services.get(IExtensionService),
				services.languageService
			),
			5000,
		));

		conversionCancellablePromise.then((elements) => {
			if (!Array.isArray(elements)) {
				setRenderedMarkdown({
					status: 'error',
					errorMsg: localize('noReactResult', 'Failed to render markdown: Invalid result returned')
				});
				return;
			}

			setRenderedMarkdown({
				status: 'success',
				nodes: elements
			});
		}).catch((error) => {
			setRenderedMarkdown({
				status: 'error',
				errorMsg: error.message
			});
		});

		return () => conversionCancellablePromise.cancel();
	}, [content, services]);

	return renderedMarkdown;
}
