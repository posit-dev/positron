/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { getWindow } from 'vs/base/browser/dom';
import { localize } from 'vs/nls';
import { INotebookOutputWebview } from 'vs/workbench/contrib/positronOutputWebview/browser/notebookOutputWebviewService';
import { assertIsStandardPositronWebview } from 'vs/workbench/contrib/positronOutputWebview/browser/notebookOutputWebviewServiceImpl';
import { IWebviewElement } from 'vs/workbench/contrib/webview/browser/webview';
import { NotebookPreloadOutputResults } from 'vs/workbench/services/positronWebviewPreloads/common/positronWebviewPreloadService';

const LOADING_MESSAGE = localize('cellExecutionLoading', 'Loading...');
const WEBVIEW_FAILED_MESSAGE = localize('cellExecutionWebviewFailed', 'Failed to create webview.');
const PRELOAD_MESSAGE = localize('cellExecutionPreloadMessage', 'Preload message');

export function PreloadMessageOutput({ preloadMessageResult }: { preloadMessageResult?: NotebookPreloadOutputResults }) {

	if (preloadMessageResult === null) {
		return <div>{LOADING_MESSAGE}</div>;
	}

	if (preloadMessageResult === undefined) {
		return <div>{WEBVIEW_FAILED_MESSAGE}</div>;
	}

	if (preloadMessageResult.preloadMessageType === 'preload') {
		return <div>{PRELOAD_MESSAGE}</div>;
	}

	return <DisplayedPreloadMessage webview={preloadMessageResult.webview} />;
}

function DisplayedPreloadMessage({ webview }: { webview: Promise<INotebookOutputWebview> }) {

	const [isLoading, setIsLoading] = React.useState(true);
	const containerRef = React.useRef<HTMLDivElement>(null);

	React.useEffect(() => {
		let disposed = false;
		let resolvedWebviewElement: IWebviewElement | undefined;

		webview.then((resolvedWebview) => {
			if (disposed) { return; }

			setIsLoading(false);
			if (!containerRef.current) { return; }

			assertIsStandardPositronWebview(resolvedWebview);
			resolvedWebviewElement = resolvedWebview.webview;
			resolvedWebviewElement.mountTo(containerRef.current, getWindow(containerRef.current));
			// Temporarily set the height to something non zero so we can see if it's working
			containerRef.current.style.height = `400px`;
		});

		return () => {
			disposed = true;
			resolvedWebviewElement?.dispose();
		};
	}, [webview]);

	return <>
		{isLoading ? <div>{LOADING_MESSAGE}</div> : null}
		<div ref={containerRef} />
	</>;
}
