/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { getWindow } from 'vs/base/browser/dom';
import { INotebookOutputWebview } from 'vs/workbench/contrib/positronOutputWebview/browser/notebookOutputWebviewService';
import { IWebviewElement } from 'vs/workbench/contrib/webview/browser/webview';
import { assertIsStandardPositronWebview } from 'vs/workbench/contrib/positronOutputWebview/browser/notebookOutputWebviewServiceImpl';


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
