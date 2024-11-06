/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

type HTMLOutputWebviewMessage = {
	type: 'webviewMetrics';
	bodyScrollHeight: number;
	bodyScrollWidth: number;
};


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


// Helper function for TypeScript typing
function acquireVsCodeApi(): { postMessage: (message: HTMLOutputWebviewMessage) => void } {
	throw new Error('Function not implemented.');
}

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

export const webviewMessageCodeString = `(${webviewMessageCode.toString()})();`;
