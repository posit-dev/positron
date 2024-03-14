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
import { ActionBarSeparator } from 'vs/platform/positronActionBar/browser/components/actionBarSeparator';
import { PreviewUrl } from 'vs/workbench/contrib/positronPreview/browser/previewUrl';

// Constants.
const kPaddingLeft = 8;
const kPaddingRight = 8;

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

	// The active preview.
	readonly preview: PreviewUrl;
}

// Localized strings.
const navigateBack = localize('positron.preview.navigateBack', "Navigate back to the previous URL");
const navigateForward = localize('positron.preview.navigateForward', "Navigate back to the next URL");
const reload = localize('positron.preview.reload', "Reload the current URL");

/**
 * ActionBars component.
 * @param props An ActionBarsProps that contains the component properties.
 * @returns The rendered component.
 */
export const ActionBars = (props: PropsWithChildren<ActionBarsProps>) => {
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

	// Render.
	return (
		<PositronActionBarContextProvider {...props}>
			<div className='action-bars'>
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
						<div className='url-bar'>
							{props.preview.currentUri.toString()}
						</div>
						<ActionBarButton
							iconId='positron-refresh'
							tooltip={reload}
							ariaLabel={reload}
							onPressed={reloadHandler} />
					</ActionBarRegion>
				</PositronActionBar>
			</div>
		</PositronActionBarContextProvider>
	);
};
