/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/
import * as React from 'react';
import { Schemas } from 'vs/base/common/network';
import { dirname, } from 'vs/base/common/resources';
import { URI } from 'vs/base/common/uri';
import { localize } from 'vs/nls';
import { useServices } from 'vs/workbench/contrib/positronNotebook/browser/ServicesProvider';
import { IPositronNotebookMarkupCell } from 'vs/workbench/contrib/positronNotebook/browser/notebookCells/interfaces';
import { useObservedValue } from 'vs/workbench/contrib/positronNotebook/browser/useObservedValue';
import { IWebviewElement, WebviewInitInfo } from 'vs/workbench/contrib/webview/browser/webview';
import { asWebviewUri } from 'vs/workbench/contrib/webview/common/webview';

export function useMarkupWebviewRenderer(cell: IPositronNotebookMarkupCell) {
	const services = useServices();

	const webviewService = services.webviewService;
	const webviewContainerRef = React.useRef<HTMLDivElement>(null);
	const renderedHtml = useObservedValue(cell.renderedHtml);
	const webviewRef = React.useRef<IWebviewElement | undefined>(undefined);

	// Creates webview and mounts it to the container
	React.useEffect(() => {
		if (!webviewContainerRef.current) {
			return;
		}

		const notebookRoot = getNotebookBaseUri(cell.notebookUri);

		const webviewInitInfo: WebviewInitInfo = {
			title: localize('markup rendering webview', "Markup Rendering Webview"),
			contentOptions: {
				allowScripts: true,
				allowMultipleAPIAcquire: true,
				localResourceRoots: [
					notebookRoot
				]
			},
			options: {},
			extension: undefined,
		};

		const webview = webviewService.createWebviewElement(webviewInitInfo);
		webview.mountTo(webviewContainerRef.current);
		webview.onMessage(({ message }) => {

			if (isWebviewMessage(message) && webviewContainerRef.current) {
				switch (message.type) {
					case 'dblclick':
						cell.toggleEditor();
						break;
					case 'markup-content-height':
						webviewContainerRef.current.style.height = `${message.value}px`;
						break;
				}
			}
		});
		webviewRef.current = webview;

		webviewContainerRef.current.addEventListener('dblclick', () => {
			cell.toggleEditor();
		});


		return () => {
			webview?.dispose();
		};
	}, [cell.notebookUri, webviewService, cell]);

	// Sync the rendered HTML to the webview HTML
	React.useEffect(() => {
		const webview = webviewRef.current;
		if (!webview) {
			return;
		}
		webview.setHtml(`
		<html lang="en">
			<head>
				<meta charset="UTF-8">
				<base href="${asWebviewUri(getNotebookBaseUri(cell.notebookUri))}/" />
				<style>
					body {}
				</style>
				<script>
					function reportHeight() {
						// Notify the extension that the webview is ready
						const vscode = acquireVsCodeApi();

						// Get size of the content
						const height = Math.max(
							document.body.scrollHeight, document.documentElement.scrollHeight,
							document.body.offsetHeight, document.documentElement.offsetHeight,
							document.body.clientHeight, document.documentElement.clientHeight
						  );

						// Send a message out to inform of size.
						// This is used to resize the webview container
						vscode.postMessage({ type: 'markup-content-height', value: height });
					}

					function reportDoubleClick() {
						const vscode = acquireVsCodeApi();
						vscode.postMessage({ type: 'dblclick'});
					}

					// Listen for resizes so we can update height of webview as dynamic height
					// content like images resize
					document.onresize = () => {
						reportHeight();
					};

					// Wait for page load to report height. This is needed
					// so things like images etc can load for height to be correct
					window.onload = () => {
						reportHeight();
					};

					window.onDblClick = () => {
						reportDoubleClick()
					};

					window.addEventListener("dblclick", (event) => {
						reportDoubleClick();
					})

				</script>
			</head>
			<body>
			${renderedHtml || '<h1>No content</h1>'}
			</body>
		</html>
		`);
	}, [cell.notebookUri, renderedHtml]);

	return webviewContainerRef;
}


function getNotebookBaseUri(notebookUri: URI) {
	if (notebookUri.scheme === Schemas.untitled) {
		// TODO: Use workspace context service to set the base URI to workspace root
		throw new Error('Have not yet implemented untitled notebook URIs');
	}

	return dirname(notebookUri);
}


type WebviewMessage = {
	type: 'markup-content-height';
	value: number;
} | {
	type: 'dblclick';
	value: null;
};



function isWebviewMessage(message: unknown): message is WebviewMessage {
	if (typeof message !== 'object' || message === null) {
		return false;
	}
	if (!('type' in message)) {
		return false;
	}

	const knownTypes: WebviewMessage['type'][] = ['markup-content-height', 'dblclick'];

	return knownTypes.includes((message as WebviewMessage).type);
}

