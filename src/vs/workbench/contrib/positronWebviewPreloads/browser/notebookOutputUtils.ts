/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


export function buildWebviewHTML(opts: {
	content: string;
	script?: string;
}): string {

	let all: string = opts.content;

	all = `<style>${htmlOutputStyles}</style>` + all;

	if (opts.script) {
		all = `<script>${opts.script}</script>` + all;
	}

	return all;
}


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


export function isHTMLOutputWebviewMessage(message: any): message is HTMLOutputWebviewMessage {
	return message?.type === 'webviewMetrics';
}

// Helper function for TypeScript typing
function acquireVsCodeApi(): { postMessage: (message: HTMLOutputWebviewMessage) => void } {
	throw new Error('Function not implemented.');
}

function webviewMessageCode() {
	const vscode = acquireVsCodeApi();

	const sendSizeMessage = () => {
		// Get body of the webview and measure content sizes
		// eslint-disable-next-line no-restricted-syntax
		const body = document.body;
		// eslint-disable-next-line no-restricted-syntax
		const documentElement = document.documentElement;
		const bodyScrollHeight = body.scrollHeight || documentElement.scrollHeight;
		const bodyScrollWidth = body.scrollWidth || documentElement.scrollWidth;

		vscode.postMessage({
			type: 'webviewMetrics',
			bodyScrollHeight,
			bodyScrollWidth
		});
	};

	// Create resize observer to detect size changes
	const resizeObserver = new ResizeObserver(() => {
		sendSizeMessage();
	});

	try {
		// eslint-disable-next-line no-restricted-syntax
		const documentElement = document.documentElement;
		resizeObserver.observe(documentElement);
	} catch (e) {
		console.error('Error observing documentElement', e);
	}
	// Send message on load back to Positron
	// eslint-disable-next-line no-restricted-globals
	window.onload = sendSizeMessage;
}

export const webviewMessageCodeString = `(${webviewMessageCode.toString()})();`;
