/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import 'vs/css!./Markdown';

import * as React from 'react';
import { renderHtml } from 'vs/base/browser/positron/renderHtml';
import { DeferredImage } from './DeferredImage';
import { useServices } from 'vs/workbench/contrib/positronNotebook/browser/ServicesProvider';
import { ExternalLink } from 'vs/base/browser/ui/ExternalLink/ExternalLink';
import { localize } from 'vs/nls';
import { createCancelablePromise, raceTimeout } from 'vs/base/common/async';

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

	const services = useServices();
	const [renderedHtml, setRenderedHtml] = React.useState<MarkdownRenderResults>({
		status: 'rendering'
	});

	React.useEffect(() => {

		const conversionCancellablePromise = createCancelablePromise(() => raceTimeout(
			services.commandService.executeCommand('markdown.api.render', content),
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
				nodes: renderHtml(html, {
					componentOverrides: {
						img: DeferredImage,
						a: (props) => <ExternalLink {...props} openerService={services.openerService} />
					}
				})
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

