/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./actionBars';
import * as React from 'react';
import { PropsWithChildren, useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { localize } from 'vs/nls';
import { PositronActionBar } from 'vs/platform/positronActionBar/browser/positronActionBar';
import { PositronActionBarContextProvider } from 'vs/platform/positronActionBar/browser/positronActionBarContext';
import { kPaddingLeft, kPaddingRight, PreviewActionBarsProps } from 'vs/workbench/contrib/positronPreview/browser/components/actionBars';
import { PreviewHtml } from 'vs/workbench/contrib/positronPreview/browser/previewHtml';
import { ActionBarRegion } from 'vs/platform/positronActionBar/browser/components/actionBarRegion';
import { ActionBarButton } from 'vs/platform/positronActionBar/browser/components/actionBarButton';
import { ActionBarSeparator } from 'vs/platform/positronActionBar/browser/components/actionBarSeparator';
import { DisposableStore } from 'vs/base/common/lifecycle';

const reload = localize('positron.preview.html.reload', "Reload the content");
const clear = localize('positron.preview.html.clear', "Clear the content");
const openInBrowser = localize('positron.preview.html.openInBrowser', "Open the content in the default browser");
const openInEditor = localize('positron.preview.html.openInEditor', "Open the content in an editor tab.")

/**
 * HtmlActionBarsProps interface.
 */
export interface HtmlActionBarsProps extends PreviewActionBarsProps {

	// The active preview.
	readonly preview: PreviewHtml;
}

export const HtmlActionBars = (props: PropsWithChildren<HtmlActionBarsProps>) => {

	const [title, setTitle] = useState(props.preview.html.title);

	// Handler for the reload button.
	const reloadHandler = () => {
		props.preview.webview.postMessage({
			channel: 'execCommand',
			data: 'reload-window'
		});
	};

	// Handler for the clear button.
	const clearHandler = () => {
		props.positronPreviewService.clearAllPreviews();
	};

	// Handler for the open in browser button.
	const openInBrowserHandler = () => {
		props.openerService.open(props.preview.uri,
			{ openExternal: true, fromUserGesture: true });
	};

	// Handler for open in editor button
	const openInEditorHandler = () => {
		props.positronPreviewService.openEditor()
	}

	// Main use effect.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();
		disposableStore.add(props.preview.webview.onDidLoad((title) => {
			if (title) {
				setTitle(title);
			}
		}));
		return () => disposableStore.dispose();
	}, [props.preview.webview]);

	// Render.
	return (
		<PositronActionBarContextProvider {...props}>
			<div className='action-bars preview-action-bar'>
				<PositronActionBar size='small' borderTop={true} borderBottom={true} paddingLeft={kPaddingLeft} paddingRight={kPaddingRight}>
					<ActionBarRegion location='left'>
						<span className='codicon codicon-file'></span>
					</ActionBarRegion>
					<ActionBarRegion location='center'>
						<span className='preview-title'>{title}</span>
					</ActionBarRegion>
					<ActionBarRegion location='right'>
						<ActionBarButton
							iconId='positron-refresh'
							align='right'
							tooltip={reload}
							ariaLabel={reload}
							onPressed={reloadHandler} />
						<ActionBarButton
							iconId='positron-open-in-new-window'
							align='right'
							tooltip={openInBrowser}
							ariaLabel={openInBrowser}
							onPressed={openInBrowserHandler} />
						<ActionBarSeparator />
						<ActionBarButton
							iconId='positron-open-in-editor'
							align='right'
							tooltip={openInEditor}
							ariaLabel={openInEditor}
							onPressed={openInEditorHandler} />
						<ActionBarSeparator />
						<ActionBarButton
							iconId='clear-all'
							align='right'
							tooltip={clear}
							ariaLabel={clear}
							onPressed={clearHandler} />
					</ActionBarRegion>
				</PositronActionBar>
			</div>
		</PositronActionBarContextProvider>
	);
};
