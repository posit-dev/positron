/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import 'vs/css!./NotebookCodeCell';

import * as React from 'react';
import { getWindow } from 'vs/base/browser/dom';
import { localize } from 'vs/nls';
import { transformWebviewThemeVars } from 'vs/workbench/contrib/notebook/browser/view/renderers/webviewThemeMapping';
import { useServices } from 'vs/workbench/contrib/positronNotebook/browser/ServicesProvider';
import { WebviewContentPurpose } from 'vs/workbench/contrib/webview/browser/webview';


// Styles that get added to the HTML content of the webview for things like cleaning
// up tables etc..
const htmlOutputStyles = `
table {
	width: 100%;
	border-collapse: collapse;
}
table, th, td {
	border: 1px solid #ddd;
}
th, td {
	padding: 8px;
	text-align: left;
}
tr:nth-child(even) {
	background-color: var(--vscode-textBlockQuote-background, #f2f2f2);
}
`;


type HTMLOutputWebviewMessage = {
	type: 'webviewMetrics';
	bodyScrollHeight: number;
	bodyScrollWidth: number;
};

// No external imported code allowed.
// This function gets stringified and injected into the webview
// to send messages back to the Positron host.
function webviewMessageCode() {
	const vscode = acquireVsCodeApi();
	// Send message on load back to Positron
	// eslint-disable-next-line no-restricted-globals
	window.onload = () => {
		// Get body of the webview and measure content sizes
		// eslint-disable-next-line no-restricted-syntax
		const body = document.body;
		const bodyScrollHeight = body.scrollHeight;
		const bodyScrollWidth = body.scrollWidth;

		vscode.postMessage({
			type: 'webviewMetrics',
			bodyScrollHeight,
			bodyScrollWidth
		});
	};
}

function isHTMLOutputWebviewMessage(message: any): message is HTMLOutputWebviewMessage {
	return message?.type === 'webviewMetrics';
}

// Fake implementation for function that gets injected into the webview so we can get typing here.
function acquireVsCodeApi(): { postMessage: (message: HTMLOutputWebviewMessage) => void } {
	throw new Error('Function not implemented.');
}


export function NotebookHTMLContent({ content }: { content: string }) {
	const { webviewService } = useServices();

	const containerRef = React.useRef<HTMLDivElement>(null);

	React.useEffect(() => {
		if (!containerRef.current) {
			return;
		}

		const webviewElement = webviewService.createWebviewElement({
			title: localize('positron.notebook.webview', "Positron Notebook HTML content"),
			options: {
				purpose: WebviewContentPurpose.NotebookRenderer,
				enableFindWidget: false,
				transformCssVariables: transformWebviewThemeVars,
			},
			contentOptions: {
				allowMultipleAPIAcquire: true,
				allowScripts: true,
			},
			extension: undefined,
			providedViewType: 'notebook.output'
		});

		const contentWithStyles = buildWebviewHTML({
			content,
			styles: htmlOutputStyles,
			script: `(${webviewMessageCode.toString()})();`
		});

		webviewElement.setHtml(contentWithStyles);
		webviewElement.onMessage(({ message }) => {
			if (!isHTMLOutputWebviewMessage(message) || !containerRef.current) { return; }
			// Set the height of the webview to the height of the content
			// Don't allow the webview to be taller than 1000px
			const boundedHeight = Math.min(message.bodyScrollHeight, 1000);
			containerRef.current.style.height = `${boundedHeight}px`;
		});
		webviewElement.mountTo(containerRef.current, getWindow(containerRef.current));
		return () => webviewElement.dispose();
	}, [content, webviewService]);

	return <div className='positron-notebook-html-output' ref={containerRef}></div>;
}

function buildWebviewHTML(opts: {
	content: string;
	styles?: string;
	script?: string;
}): string {

	let all: string = opts.content;

	if (opts.styles) {
		all = `<style>${opts.styles}</style>` + all;
	}

	if (opts.script) {
		all = `<script>${opts.script}</script>` + all;
	}

	return all;
}
