/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { getWindow } from 'vs/base/browser/dom';
import { INotebookOutputWebview } from 'vs/workbench/contrib/positronOutputWebview/browser/notebookOutputWebviewService';
import { IWebviewElement } from 'vs/workbench/contrib/webview/browser/webview';
import { assertIsStandardPositronWebview } from 'vs/workbench/contrib/positronOutputWebview/browser/notebookOutputWebviewServiceImpl';
import { isHTMLOutputWebviewMessage } from 'vs/workbench/contrib/positronWebviewPreloads/browser/notebookOutputUtils';


export function useWebviewMount(webview: Promise<INotebookOutputWebview>) {
	const [isLoading, setIsLoading] = React.useState(true);
	const [error, setError] = React.useState<Error | null>(null);
	const containerRef = React.useRef<HTMLDivElement>(null);

	React.useEffect(() => {
		const controller = new AbortController();
		let webviewElement: IWebviewElement | undefined;

		async function mountWebview() {
			try {
				const resolvedWebview = await webview;

				if (controller.signal.aborted || !containerRef.current) {
					return;
				}

				setIsLoading(false);
				assertIsStandardPositronWebview(resolvedWebview);
				webviewElement = resolvedWebview.webview;
				webviewElement.mountTo(
					containerRef.current,
					getWindow(containerRef.current)
				);

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

			} catch (err) {
				setError(err instanceof Error ? err : new Error('Failed to mount webview'));
				setIsLoading(false);
			}
		}

		mountWebview();

		return () => {
			controller.abort();
			webviewElement?.dispose();
		};
	}, [webview]);

	return { containerRef, isLoading, error };
}
