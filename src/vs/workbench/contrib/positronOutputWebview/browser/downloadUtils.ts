/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IClickedDataUrlMessage } from '../../notebook/browser/view/renderers/webviewMessages.js';


export function msgIsDownloadMessage(msg: any): msg is IClickedDataUrlMessage {
	if (!msg.__vscode_notebook_message) {
		return false;
	}
	return msg.type === 'clicked-data-url';
}

// Let typescript know that the vscode object is available
declare const vscode: {
	postMessage(message: IClickedDataUrlMessage): void;
};

// Function is meant to be dependency free so it can be serialized into the webview with the
// Function.toString() method
// The logic here is largely taken from the `webviewPreloads.ts` file that gets injected into
// notebook webviews. The implementation here is a bit simpler because there's contexts that don't
// apply to the positron webviews that are handled in the notebook webviews.
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
			__vscode_notebook_message: true,
			type: 'clicked-data-url',
			data,
			downloadName
		});
	};

	// Override the prompt function to return the default value or 'myFile' if one isnt provided.
	// This is needed because the prompt function is not supported in webviews and the prompt function
	// is commonly used by libraries like bokeh to provide names for files to save. The main file save
	// dialog that positron shows will already provide the ability to change the file name so we're
	// just providing a default value here.
	window.prompt = (message, _default) => {
		return _default ?? 'Untitled';
	};
}

/**
 * A string containing function to be injected into a webview to handle clicks on anchor elements.
 * Pairs with listeners in the webview listening for the messages from the webview of the type
 * 'PositronDownloadMessage'.
 */
export const handleWebviewLinkClicksInjection = `(${handleWebviewClicks.toString()})()`;
