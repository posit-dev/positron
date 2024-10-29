/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { useEffect, useState } from 'react';
import { localize } from 'vs/nls';
import { NotebookPreloadOutputResults } from 'vs/workbench/services/positronWebviewPreloads/common/positronWebviewPreloadService';

const LOADING_MESSAGE = localize('cellExecutionLoading', 'Loading...');
const WEBVIEW_FAILED_MESSAGE = localize('cellExecutionWebviewFailed', 'Failed to create webview.');
const DISPLAY_MESSAGE = localize('cellExecutionDisplayMessage', 'Display message');
const PRELOAD_MESSAGE = localize('cellExecutionPreloadMessage', 'Preload message');

export function PreloadMessageOutput({ preloadMessageResult }: { preloadMessageResult: Promise<NotebookPreloadOutputResults | undefined> }) {
	const [result, setResult] = useState<NotebookPreloadOutputResults | undefined | null>(null);

	useEffect(() => {
		preloadMessageResult.then(setResult);
	}, [preloadMessageResult]);

	if (result === null) {
		return <div>{LOADING_MESSAGE}</div>;
	}

	if (result === undefined) {
		return <div>{WEBVIEW_FAILED_MESSAGE}</div>;
	}

	if (result.preloadMessageType === 'display') {
		return <div>{DISPLAY_MESSAGE}</div>;
	}

	return <div>{PRELOAD_MESSAGE}</div>;
}
