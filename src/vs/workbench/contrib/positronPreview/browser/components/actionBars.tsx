/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./actionBars';
import * as React from 'react';
import { PropsWithChildren, } from 'react'; // eslint-disable-line no-duplicate-imports
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { PositronActionBar } from 'vs/platform/positronActionBar/browser/positronActionBar';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { PositronActionBarContextProvider } from 'vs/platform/positronActionBar/browser/positronActionBarContext';
import { PositronSessionsServices } from 'vs/workbench/contrib/positronRuntimeSessions/browser/positronRuntimeSessionsState';
import { ActionBarRegion } from 'vs/platform/positronActionBar/browser/components/actionBarRegion';
import { ActionBarButton } from 'vs/platform/positronActionBar/browser/components/actionBarButton';
import { localize } from 'vs/nls';
import { PreviewUrl } from 'vs/workbench/contrib/positronPreview/browser/previewUrl';
import { IPositronPreviewService } from 'vs/workbench/contrib/positronPreview/browser/positronPreviewSevice';
import { ActionBarSeparator } from 'vs/platform/positronActionBar/browser/components/actionBarSeparator';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { URI } from 'vs/base/common/uri';
import { INotificationService } from 'vs/platform/notification/common/notification';

// Constants.
const kPaddingLeft = 8;
const kPaddingRight = 8;
const kUrlBarInputName = 'url-bar';

/**
 * ActionBarsProps interface.
 */
export interface ActionBarsProps extends PositronSessionsServices {
	// Services.
	readonly commandService: ICommandService;
	readonly configurationService: IConfigurationService;
	readonly contextKeyService: IContextKeyService;
	readonly contextMenuService: IContextMenuService;
	readonly keybindingService: IKeybindingService;
	readonly layoutService: IWorkbenchLayoutService;
	readonly notificationService: INotificationService;
	readonly openerService: IOpenerService;
	readonly positronPreviewService: IPositronPreviewService;

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

/**
 * ActionBars component.
 * @param props An ActionBarsProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActionBars = (props: PropsWithChildren<ActionBarsProps>) => {
	// Save the current URL.
	const currentUri = props.preview.currentUri;

	const urlInputRef = React.useRef<HTMLInputElement>(null);

	// Handler for the navigate back button.
	const navigateBackHandler = () => {
		props.preview.webview.postMessage({ command: 'back' });
	};

	// Handler for the navigate forward button.
	const navigateForwardHandler = () => {
		props.preview.webview.postMessage({ command: 'forward' });
	};

	// Handler for the reload button.
	const reloadHandler = () => {
		props.preview.webview.postMessage({ command: 'reload' });
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

	// Render.
	return (
		<PositronActionBarContextProvider {...props}>
			<div className='action-bars preview-action-bar'>
				<PositronActionBar size='small' borderTop={true} borderBottom={true} paddingLeft={kPaddingLeft} paddingRight={kPaddingRight}>
					<ActionBarRegion location='left'>
						<ActionBarButton iconId='positron-left-arrow'
							tooltip={navigateBack}
							ariaLabel={navigateBack}
							onPressed={navigateBackHandler} />
						<ActionBarButton
							iconId='positron-right-arrow'
							tooltip={navigateForward}
							ariaLabel={navigateForward}
							onPressed={navigateForwardHandler} />
					</ActionBarRegion>
					<ActionBarRegion location='center'>
						<form onSubmit={navigateToHandler}>
							<input
								className='url-bar'
								aria-label={currentUrl}
								name={kUrlBarInputName}
								type='text'
								ref={urlInputRef}
								defaultValue={props.preview.currentUri.toString()}>
							</input>
						</form>
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
