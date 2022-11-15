/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronHelp';
import * as React from 'react';
import { PropsWithChildren } from 'react'; // eslint-disable-line no-duplicate-imports
import { localize } from 'vs/nls';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { PositronActionBar } from 'vs/platform/positronActionBar/browser/positronActionBar';
import { ActionBarButton } from 'vs/platform/positronActionBar/browser/components/actionBarButton';
import { ActionBarRegion } from 'vs/platform/positronActionBar/browser/components/actionBarRegion';
import { TestContent } from 'vs/workbench/contrib/positronEnvironment/browser/components/testContent';
import { ActionBarSeparator } from 'vs/platform/positronActionBar/browser/components/actionBarSeparator';
import { PositronActionBarContextProvider } from 'vs/platform/positronActionBar/browser/positronActionBarContext';

/**
 * PositronHelpProps interface.
 */
export interface PositronHelpProps {
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
	// Render.
	return (
		<div className='positron-help'>
			<PositronActionBarContextProvider {...props}>
				<PositronActionBar>
					<ActionBarRegion align='left'>
						<ActionBarButton iconId='positron-left-arrow' tooltip={localize('positronPreviousTopic', "Previous topic")} />
						<ActionBarButton iconId='positron-right-arrow' tooltip={localize('positronNextTopic', "Next topic")} />
						<ActionBarButton iconId='positron-home' tooltip={localize('positronShowPositronHelp', "Show Positron help")} />
						<ActionBarSeparator />
						<ActionBarButton iconId='positron-open-in-new-window' tooltip={localize('positronShowInNewWindow', "Show in new window")} />
					</ActionBarRegion>
					<ActionBarRegion align='right'>
						<ActionBarButton iconId='positron-refresh' tooltip={localize('positronRefreshTopic', "Refresh topic")} align='right' />
					</ActionBarRegion>
				</PositronActionBar>
				<PositronActionBar>
					<ActionBarRegion align='left'>
						<ActionBarButton text='Home' dropDown={true} tooltip={localize('positronHelpHistory', "Help history")} />
					</ActionBarRegion>
					<ActionBarRegion align='right'>
					</ActionBarRegion>
				</PositronActionBar>
			</PositronActionBarContextProvider>

			<TestContent message='Help React' />
		</div>
	);
};
