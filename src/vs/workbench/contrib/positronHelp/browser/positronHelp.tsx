/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronHelp';
import * as React from 'react';
import { PropsWithChildren, useEffect } from 'react'; // eslint-disable-line no-duplicate-imports
import { localize } from 'vs/nls';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IReactComponentContainer } from 'vs/base/browser/positronReactRenderer';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { PositronActionBar } from 'vs/platform/positronActionBar/browser/positronActionBar';
import { ActionBarFind } from 'vs/platform/positronActionBar/browser/components/actionBarFind';
import { TestContent } from 'vs/workbench/contrib/positronHelp/browser/components/testContent';
import { ActionBarButton } from 'vs/platform/positronActionBar/browser/components/actionBarButton';
import { ActionBarRegion } from 'vs/platform/positronActionBar/browser/components/actionBarRegion';
import { ActionBarSeparator } from 'vs/platform/positronActionBar/browser/components/actionBarSeparator';
import { PositronActionBarContextProvider } from 'vs/platform/positronActionBar/browser/positronActionBarContext';

/**
 * PositronHelpProps interface.
 */
export interface PositronHelpProps {
	reactComponentContainer: IReactComponentContainer;
	commandService: ICommandService;
	configurationService: IConfigurationService;
	contextKeyService: IContextKeyService;
	contextMenuService: IContextMenuService;
	keybindingService: IKeybindingService;
}


/**
 * PositronHelp component.
 * @param props A PositronHelpProps that contains the component properties.
 */
export const PositronHelp = (props: PropsWithChildren<PositronHelpProps>) => {
	// Add IReactComponentContainer event handlers.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onSizeChanged event handler.
		disposableStore.add(props.reactComponentContainer.onSizeChanged(e => {
			console.log(`PositronHelp got onSizeChanged ${e.width},${e.height}`);
		}));

		// Add the onVisibilityChanged event handler.
		disposableStore.add(props.reactComponentContainer.onVisibilityChanged(e => {
			console.log(`PositronHelp got onVisibilityChanged ${e}`);
		}));

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, []);

	// Render.
	return (
		<div className='positron-help'>
			<PositronActionBarContextProvider {...props}>
				<PositronActionBar size='small'>
					<ActionBarRegion align='left'>
						<ActionBarButton iconId='positron-left-arrow' tooltip={localize('positronPreviousTopic', "Previous topic")} />
						<ActionBarButton iconId='positron-right-arrow' tooltip={localize('positronNextTopic', "Next topic")} />
						<ActionBarButton iconId='positron-home' tooltip={localize('positronShowPositronHelp', "Show Positron help")} />
						<ActionBarSeparator />
						<ActionBarButton iconId='positron-open-in-new-window' tooltip={localize('positronShowInNewWindow', "Show in new window")} />
					</ActionBarRegion>
					<ActionBarRegion align='right'>
					</ActionBarRegion>
				</PositronActionBar>
				<PositronActionBar size='small' borderBottom={true}>
					<ActionBarRegion align='left'>
						<ActionBarButton text='Home' dropDown={true} tooltip={localize('positronHelpHistory', "Help history")} />
						<ActionBarFind placeholder={localize('positronFindPlaceholder', "find")} />
					</ActionBarRegion>
					<ActionBarRegion align='right'>
					</ActionBarRegion>
				</PositronActionBar>
			</PositronActionBarContextProvider>

			<TestContent message='Help React' />
		</div>
	);
};
