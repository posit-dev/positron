/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './actionBars.css';

// React.
import React, { PropsWithChildren, useEffect, useState } from 'react';

// Other dependencies.
import { localize } from '../../../../../nls.js';
import { PositronActionBar } from '../../../../../platform/positronActionBar/browser/positronActionBar.js';
import { PositronActionBarContextProvider } from '../../../../../platform/positronActionBar/browser/positronActionBarContext.js';
import { kPaddingLeft, kPaddingRight, PreviewActionBarsProps } from './actionBars.js';
import { PreviewHtml } from '../previewHtml.js';
import { ActionBarRegion } from '../../../../../platform/positronActionBar/browser/components/actionBarRegion.js';
import { ActionBarButton } from '../../../../../platform/positronActionBar/browser/components/actionBarButton.js';
import { ActionBarSeparator } from '../../../../../platform/positronActionBar/browser/components/actionBarSeparator.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';

const reload = localize('positron.preview.html.reload', "Reload the content");
const clear = localize('positron.preview.html.clear', "Clear the content");
const openInBrowser = localize('positron.preview.html.openInBrowser', "Open the content in the default browser");
const openInEditor = localize('positron.preview.html.openInEditor', "Open the content in an editor tab");

/**
 * HtmlActionBarsProps interface.
 */
export interface HtmlActionBarsProps extends PreviewActionBarsProps {

	// The active preview.
	readonly preview: PreviewHtml;
}

export const HtmlActionBars = (props: PropsWithChildren<HtmlActionBarsProps>) => {

	const [title, setTitle] = useState(props.preview.html?.title);

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
		props.positronPreviewService.openEditor(props.preview.uri, title);
	};

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
				<PositronActionBar borderBottom={true} borderTop={true} paddingLeft={kPaddingLeft} paddingRight={kPaddingRight} size='small'>
					<ActionBarRegion location='left'>
						<span className='codicon codicon-file'></span>
					</ActionBarRegion>
					<ActionBarRegion location='center'>
						<span className='preview-title'>{title}</span>
					</ActionBarRegion>
					<ActionBarRegion location='right'>
						<ActionBarButton
							align='right'
							ariaLabel={reload}
							iconId='positron-refresh'
							tooltip={reload}
							onPressed={reloadHandler} />
						<ActionBarButton
							align='right'
							ariaLabel={openInBrowser}
							iconId='positron-open-in-new-window'
							tooltip={openInBrowser}
							onPressed={openInBrowserHandler} />
						<ActionBarSeparator />
						<ActionBarButton
							align='right'
							ariaLabel={openInEditor}
							iconId='go-to-file'
							tooltip={openInEditor}
							onPressed={openInEditorHandler} />
						<ActionBarSeparator />
						<ActionBarButton
							align='right'
							ariaLabel={clear}
							iconId='clear-all'
							tooltip={clear}
							onPressed={clearHandler} />
					</ActionBarRegion>
				</PositronActionBar>
			</div>
		</PositronActionBarContextProvider>
	);
};
