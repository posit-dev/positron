/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { getWindow } from '../../../../../../base/browser/dom.js';
import { INotebookOutputWebview } from '../../../../positronOutputWebview/browser/notebookOutputWebviewService.js';
import { isHTMLOutputWebviewMessage } from '../../../../positronWebviewPreloads/browser/notebookOutputUtils.js';
import { useNotebookInstance } from '../../NotebookInstanceProvider.js';
import { IOverlayWebview } from '../../../../webview/browser/webview.js';
import { toDisposable } from '../../../../../../base/common/lifecycle.js';


export function useWebviewMount(webview: Promise<INotebookOutputWebview>) {
	const [isLoading, setIsLoading] = React.useState(true);
	const [error, setError] = React.useState<Error | null>(null);
	const containerRef = React.useRef<HTMLDivElement>(null);
	const notebookInstance = useNotebookInstance();

	React.useEffect(() => {
		const controller = new AbortController();
		let webviewElement: IOverlayWebview | undefined;

		/**
		 * Updates the layout of the webview element if both the webview and container are available
		 */
		function updateWebviewLayout() {
			if (!webviewElement || !containerRef.current) { return; }
			webviewElement.layoutWebviewOverElement(
				containerRef.current,
				undefined,
				notebookInstance.cellsContainer
			);
		}

		async function mountWebview() {
			const emptyDisposable = toDisposable(() => { });
			try {
				const resolvedWebview = await webview;

				if (controller.signal.aborted || !containerRef.current) {
					return emptyDisposable;
				}

				setIsLoading(false);
				webviewElement = resolvedWebview.webview;

				webviewElement.claim(
					containerRef,
					getWindow(containerRef.current),
					undefined
				);

				// Initial layout
				updateWebviewLayout();

				// Update layout on scroll and visibility changes
				const scrollDisposable = notebookInstance.onDidScrollCellsContainer(updateWebviewLayout);

				webviewElement.onMessage((x) => {
					const { message } = x;
					if (!isHTMLOutputWebviewMessage(message) || !containerRef.current) { return; }
					// Set the height of the webview to the height of the content
					// Don't allow the webview to be taller than 1000px
					const maxHeight = 1000;
					let boundedHeight = Math.min(message.bodyScrollHeight, maxHeight);
					if (boundedHeight === 150) {
						// 150 is a default size that we want to avoid, otherwise we'll get
						// empty outputs that are 150px tall
						boundedHeight = 0;
					}
					containerRef.current.style.height = `${boundedHeight}px`;
				});

				return scrollDisposable;

			} catch (err) {
				setError(err instanceof Error ? err : new Error('Failed to mount webview'));
				setIsLoading(false);
				return emptyDisposable;
			}
		}

		mountWebview();

		return () => {
			controller.abort();
			webviewElement?.dispose();
		};
	}, [webview, notebookInstance]);

	return { containerRef, isLoading, error };
}
