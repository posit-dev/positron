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
				allowMultipleAPIAcquire: true,
				localResourceRoots: [
					notebookRoot
				]
			},
			options: {},
			extension: undefined,
		};

		webviewRef.current = webviewService.createWebviewElement(webviewInitInfo);
		webviewRef.current.mountTo(webviewContainerRef.current);

		return () => {
			webviewRef.current?.dispose();
		};
	}, [cell.notebookUri, cell.uri, webviewService]);

	// Sync the rendered HTML to the webview HTML
	React.useEffect(() => {
		if (!webviewRef.current) {
			return;
		}
		const notebookRoot = asWebviewUri(getNotebookBaseUri(cell.notebookUri));

		webviewRef.current.setHtml(`
		<html lang="en">
			<head>
				<meta charset="UTF-8">
				<base href="${notebookRoot}/" />
				<style>
					body {

					}
				</style>
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
