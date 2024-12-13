/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { localize } from '../../../../../nls.js';
import { useWebviewMount } from './hooks/useWebviewMount.js';
import { INotebookOutputWebview } from '../../../positronOutputWebview/browser/notebookOutputWebviewService.js';
import { NotebookPreloadOutputResults } from '../../../../services/positronWebviewPreloads/browser/positronWebviewPreloadService.js';

type PreloadMessageOutputProps = {
	preloadMessageResult?: NotebookPreloadOutputResults;
};

type DisplayedPreloadMessageProps = {
	webview: Promise<INotebookOutputWebview>;
};

const MESSAGES = {
	LOADING: localize('cellExecutionLoading', 'Loading...'),
	WEBVIEW_FAILED: localize('cellExecutionWebviewFailed', 'Failed to create webview.'),
} as const;

export function PreloadMessageOutput({ preloadMessageResult }: PreloadMessageOutputProps) {

	if (preloadMessageResult === null) {
		return <div>{MESSAGES.LOADING}</div>;
	}

	if (preloadMessageResult === undefined) {
		return <div>{MESSAGES.WEBVIEW_FAILED}</div>;
	}

	if (preloadMessageResult.preloadMessageType === 'preload') {
		return null;
	}

	// We assert types here due to not being able to import the full INotebookOutputWebview type
	// from positronOutputWebview.ts into the webview preload service.
	return <DisplayedPreloadMessage webview={preloadMessageResult.webview as Promise<INotebookOutputWebview>} />;
}

function DisplayedPreloadMessage({ webview }: DisplayedPreloadMessageProps) {
	const { containerRef, isLoading, error } = useWebviewMount(webview);

	if (error) {
		return <div>{error.message}</div>;
	}

	return (
		<>
			{isLoading && <div>{MESSAGES.LOADING}</div>}
			<div ref={containerRef} />
		</>
	);
}


