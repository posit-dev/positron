/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './actionBars.css';

// React.
import React, { PropsWithChildren, useEffect } from 'react';

// Other dependencies.
import { PositronActionBar } from '../../../../../platform/positronActionBar/browser/positronActionBar.js';
import { PositronActionBarContextProvider } from '../../../../../platform/positronActionBar/browser/positronActionBarContext.js';
import { ActionBarRegion } from '../../../../../platform/positronActionBar/browser/components/actionBarRegion.js';
import { ActionBarButton } from '../../../../../platform/positronActionBar/browser/components/actionBarButton.js';
import { localize } from '../../../../../nls.js';
import { PreviewUrl, QUERY_NONCE_PARAMETER } from '../previewUrl.js';
import { ActionBarSeparator } from '../../../../../platform/positronActionBar/browser/components/actionBarSeparator.js';
import { URI } from '../../../../../base/common/uri.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { kPaddingLeft, kPaddingRight, PreviewActionBarsProps } from './actionBars.js';

// Constants.
const kUrlBarInputName = 'url-bar';

/**
 * UrlActionBarsProps interface.
 */
export interface UrlActionBarsProps extends PreviewActionBarsProps {

	// The active preview.
	readonly preview: PreviewUrl;
}

// Localized strings.
const navigateBack = localize('positron.preview.navigateBack', "Navigate back to the previous URL");
const navigateForward = localize('positron.preview.navigateForward', "Navigate back to the next URL");
const reload = localize('positron.preview.reload', "Reload the current URL");
const clear = localize('positron.preview.clear', "Clear the current URL");
const openInBrowser = localize('positron.preview.openInBrowser', "Open the current URL in the default browser");
const currentUrl = localize('positron.preview.currentUrl', "The current URL");
const openInEditor = localize('positron.preview.html.openInEditor', "Open the content in an editor tab");

/**
 * UrlActionBars component.
 * @param props An ActionBarsProps that contains the component properties.
 * @returns The rendered component.
 */
export const UrlActionBars = (props: PropsWithChildren<UrlActionBarsProps>) => {
	// Save the current URL.
	const currentUri = props.preview.currentUri;

	const urlInputRef = React.useRef<HTMLInputElement>(null);

	// Handler for the navigate back button.
	const navigateBackHandler = () => {
		props.preview.webview.postMessage({
			channel: 'execCommand',
			data: 'navigate-back'
		});
	};

	// Handler for the navigate forward button.
	const navigateForwardHandler = () => {
		props.preview.webview.postMessage({
			channel: 'execCommand',
			data: 'navigate-forward'
		});
	};

	// Handler for the reload button.
	const reloadHandler = () => {
		props.preview.webview.postMessage({
			channel: 'execCommand',
			data: 'reload-window'
		});
	};

	const openInEditorHandler = () => {
		props.positronPreviewService.openEditor(currentUri);
	};

	// Handler for the clear button.
	const clearHandler = () => {
		props.positronPreviewService.clearAllPreviews();
	};

	// Handler for the open in browser button.
	const openInBrowserHandler = () => {
		props.openerService.open(props.preview.currentUri,
			{ openExternal: true, fromUserGesture: true });
	};

	// Perform navigation to the given URL.
	const navigateToUrl = (url: string) => {
		// If the URL doesn't start with a scheme, assume it's an HTTP URL.
		if (!url.match(/^[a-zA-Z]+:\/\//)) {
			url = `http://${url}`;
		}

		// Validate the URL.
		let uri: URI;
		try {
			uri = URI.parse(url);
		} catch (e) {
			// Notify the user that the URL is invalid.
			props.notificationService.error(localize('positron.viewer.invalidUrl', "The URL {0} is invalid: {1}", url, e));

			// Restore the old input value.
			if (urlInputRef.current) {
				urlInputRef.current.value = currentUri.toString();
			}

			return;
		}

		// Navigate to the URL.
		props.preview.navigateToUri(uri);
	};

	// Handler that runs when the user submits the URL bar form.
	const navigateToHandler = (event: React.FormEvent) => {
		// Prevent default form action
		event.preventDefault();

		// Navigate to the URL.
		if (urlInputRef.current) {
			navigateToUrl(urlInputRef.current.value);
		}
	};

	// useEffect hook.
	useEffect(() => {
		const disposables = new DisposableStore();
		disposables.add(props.preview.onDidNavigate(e => {
			if (urlInputRef.current) {
				// Remove the nonce from the URL before updating the input; we
				// use this this for cache busting but the user doesn't need to
				// see it.
				if (e.query) {
					const nonceIndex = e.query.indexOf(`${QUERY_NONCE_PARAMETER}=`);
					if (nonceIndex !== -1) {
						const nonceEnd = e.query.indexOf('&', nonceIndex);
						if (nonceEnd !== -1) {
							e = e.with({
								query: e.query.slice(0, nonceIndex) + e.query.slice(nonceEnd + 1)
							});
						} else {
							e = e.with({
								query: e.query.slice(0, nonceIndex)
							});
						}
					}
				}
				urlInputRef.current.value = e.toString();
			}
		}));
		return () => disposables.dispose();
	}, [props.preview]);

	// Render.
	return (
		<PositronActionBarContextProvider {...props}>
			<div className='action-bars preview-action-bar'>
				<PositronActionBar borderBottom={true} borderTop={true} paddingLeft={kPaddingLeft} paddingRight={kPaddingRight} size='small'>
					<ActionBarRegion location='left'>
						<ActionBarButton ariaLabel={navigateBack}
							iconId='positron-left-arrow'
							tooltip={navigateBack}
							onPressed={navigateBackHandler} />
						<ActionBarButton
							ariaLabel={navigateForward}
							iconId='positron-right-arrow'
							tooltip={navigateForward}
							onPressed={navigateForwardHandler} />
					</ActionBarRegion>
					<ActionBarRegion location='center'>
						<form onSubmit={navigateToHandler}>
							<input
								ref={urlInputRef}
								aria-label={currentUrl}
								className='text-input url-bar'
								defaultValue={props.preview.currentUri.toString()}
								name={kUrlBarInputName}
								type='text'>
							</input>
						</form>
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
