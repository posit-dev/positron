/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
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

type MarkdownRenderResults = {
	status: 'rendering';
} | {
	status: 'success';
	nodes: React.ReactElement[];
} | {
	status: 'error';
	errorMsg: string;
};

/**
 * Component that renders markdown output from IPython.display.Markdown.
 * Uses the same markdown rendering pipeline as markdown cells.
 * @param content: Markdown content to render in string form
 * @returns React element containing the rendered markdown output.
 */
export function CellMarkdownOutput({ content }: { content: string }) {
	const services = usePositronReactServicesContext();
	const [result, setResult] = React.useState<MarkdownRenderResults>({ status: 'rendering' });

	React.useEffect(() => {
		const promise = createCancelablePromise(() => raceTimeout(
			renderNotebookMarkdown(
				content,
				services.get(IExtensionService),
				services.languageService
			),
			5000,
		));

		promise.then((elements) => {
			if (!Array.isArray(elements)) {
				setResult({
					status: 'error',
					errorMsg: localize('noReactResult', 'Failed to render markdown: Invalid result returned')
				});
				return;
			}

			setResult({
				status: 'success',
				nodes: elements
			});
		}).catch((error) => {
			setResult({
				status: 'error',
				errorMsg: error.message
			});
		});

		return () => promise.cancel();
	}, [content, services]);

	switch (result.status) {
		case 'error':
			return <div className='positron-markdown-content-error'>{result.errorMsg}</div>;
		case 'rendering':
			return <div className='positron-markdown-content-rendering'>{localize('renderingMd', "Rendering...")}</div>;
		case 'success':
			return <div className='positron-markdown-content'>{result.nodes}</div>;
	}
}
