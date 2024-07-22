/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import 'vs/css!./NotebookCodeCell';

import * as React from 'react';
import { getWindow } from 'vs/base/browser/dom';
import { useServices } from 'vs/workbench/contrib/positronNotebook/browser/ServicesProvider';
import { useNotebookInstance } from 'vs/workbench/contrib/positronNotebook/browser/NotebookInstanceProvider';
import { WebviewType } from 'vs/workbench/contrib/positronOutputWebview/browser/notebookOutputWebviewService';
import { useObservedValue } from 'vs/workbench/contrib/positronNotebook/browser/useObservedValue';
import { WebviewElement } from 'vs/workbench/contrib/webview/browser/webviewElement';


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


export function NotebookHTMLContent({ content, outputId }: { content: string; outputId: string }) {
	const containerRef = React.useRef<HTMLDivElement>(null);
	const { notebookWebviewService } = useServices();
	const instance = useNotebookInstance();
	const notebookRuntime = useObservedValue(instance.currentRuntime);

	React.useEffect(() => {
		const containerElement = containerRef.current;
		if (!containerElement) { return; }

		let disposed = false;
		// Cleanup function that will be overwritten if the webview is created.
		// If the effect gets cleaned up before the webview has been rendered it will
		// set the disposed variable to true letting the webview creation know not to
		// mount the webview.
		let cleanup = () => { disposed = true; };

		const buildWebview = async () => {
			const webviewElement = await notebookWebviewService.createRawHtmlOutput({
				id: outputId,
				runtimeOrSessionId: notebookRuntime ?? instance.identifier,
				html: buildWebviewHTML({
					content,
					styles: htmlOutputStyles,
					script: `(${webviewMessageCode.toString()})();`
				}),
				webviewType: WebviewType.Standard
			});

			// If the container has been disposed, don't mount the webview
			if (disposed) {
				webviewElement.webview.dispose();
				return;
			}

			webviewElement.webview.onMessage(({ message }) => {
				if (!isHTMLOutputWebviewMessage(message) || !containerRef.current) { return; }
				// Set the height of the webview to the height of the content
				// Don't allow the webview to be taller than 1000px
				const boundedHeight = Math.min(message.bodyScrollHeight, 1000);
				containerRef.current.style.height = `${boundedHeight}px`;
			});
			if (!(webviewElement.webview instanceof WebviewElement)) { return; }
			webviewElement.webview.mountTo(containerElement, getWindow(containerRef.current));
			cleanup = () => webviewElement.webview.dispose();
		};

		buildWebview();

		return cleanup;
	}, [content, instance.identifier, notebookRuntime, notebookWebviewService, outputId]);

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
