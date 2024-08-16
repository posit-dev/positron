/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

export type PositronDownloadMessage = {
	type: 'positronDownload';
	data: string | ArrayBuffer | null;
	downloadName: string;
};

export function msgIsDownloadMessage(msg: any): msg is PositronDownloadMessage {
	return msg.type === 'positronDownload';
}

// Let typescript know that the vscode object is available
declare const vscode: {
	postMessage(message: PositronDownloadMessage): void;
};

// Function is meant to be dependency free so it can be serialized into the webview with the
// Function.toString() method
function handleWebviewClicks() {

	// eslint-disable-next-line no-restricted-syntax
	document.addEventListener('click', (event) => {
		const suppressEvent = () => {
			event.preventDefault();
			event.stopPropagation();
		};
		for (const node of event.composedPath()) {
			// eslint-disable-next-line no-restricted-syntax
			if (node instanceof HTMLAnchorElement && node.href) {
				if (node.href.startsWith('blob:')) {
					handleBlobUrlClick(node.href, node.download);
					suppressEvent();
				} else if (node.href.startsWith('data:')) {
					handleDataUrl(node.href, node.download);
					suppressEvent();
				} else {
					console.log('handleDataUrl called with unknown href type', node.href);
				}
				break;
			}
		}
	});

	const handleBlobUrlClick = async (url: string, downloadName: string) => {
		try {
			const response = await fetch(url);
			const blob = await response.blob();
			const reader = new FileReader();
			reader.addEventListener('load', () => {
				handleDataUrl(reader.result, downloadName);
			});
			reader.readAsDataURL(blob);
		} catch (e) {
			console.error(e.message);
		}
	};

	const handleDataUrl = async (data: string | ArrayBuffer | null, downloadName: string) => {
		vscode.postMessage({
			type: 'positronDownload',
			data,
			downloadName
		});
	};
}

/**
 * A string containing function to be injected into a webview to handle clicks on anchor elements.
 * Pairs with listeners in the webview listening for the messages from the webview of the type
 * 'PositronDownloadMessage'.
 */
export const handleWebviewLinkClicksInjection = `(${handleWebviewClicks.toString()})()`;
