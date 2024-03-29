/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
import 'vs/css!./Markdown';

import * as React from 'react';
import { renderHtml } from 'vs/base/browser/renderHtml';
import { DeferredImage } from './DeferredImage';
import { useServices } from 'vs/workbench/contrib/positronNotebook/browser/ServicesProvider';
import { ExternalLink } from 'vs/base/browser/ui/ExternalLink/ExternalLink';
import { localize } from 'vs/nls';
import { commandWithTimeout } from 'vs/workbench/contrib/positronNotebook/common/utils/commandWithTimeout';

/**
 * Component that render markdown content from a string.
 * @param content: Markdown content to render in string form
 * @returns React element containing the rendered markdown.
 */
export function Markdown({ content }: { content: string }) {

	const renderedHtml = useMarkdown(content);

	switch (renderedHtml.status) {
		case 'error':
			return <div>{localize('errorRenderingMd', 'Error rendering markdown:')} {renderedHtml.errorMsg}</div>;
		case 'rendering':
			return <div>{localize('renderingMd', "Rendering markdown...")}</div>;
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

		const timeoutMs = 5000;

		const renderCommand = commandWithTimeout({
			command: 'markdown.api.render',
			args: [content],
			timeoutMs,
			commandService: services.commandService,
			onSuccess: (html) => {
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
			},
			onTimeout: () => {
				setRenderedHtml({
					status: 'error',
					errorMsg: localize('renderingMdTimeout', "Rendering markdown timed out after {0} ms", timeoutMs)
				});
			},
			onError: (error) => {
				setRenderedHtml({
					status: 'error',
					errorMsg: error.message
				});
			}
		});

		return () => renderCommand.clear();
	}, [content, services]);

	return renderedHtml;
}

