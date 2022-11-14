/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronHelp';
import * as React from 'react';
import { PropsWithChildren } from 'react'; // eslint-disable-line no-duplicate-imports
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { PositronActionBar } from 'vs/platform/positronActionBar/browser/positronActionBar';
import { TestContent } from 'vs/workbench/contrib/positronEnvironment/browser/components/testContent';
import { PositronActionBarContextProvider } from 'vs/platform/positronActionBar/browser/positronActionBarContext';
import { ActionBarButton } from 'vs/platform/positronActionBar/browser/components/actionBarButton';

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
	return (
		<div>
			<PositronActionBarContextProvider {...props}>
				<PositronActionBar>
					<ActionBarButton iconId='positron-save' tooltip={'uauaua'}></ActionBarButton>
					<ActionBarButton iconId='positron-save' tooltip={'uauaua'}></ActionBarButton>
					<ActionBarButton iconId='positron-save' tooltip={'uauaua'}></ActionBarButton>
					<ActionBarButton iconId='positron-save' tooltip={'uauaua'}></ActionBarButton>
				</PositronActionBar>
			</PositronActionBarContextProvider>

			<TestContent message='Help React' />
		</div>
	);
};
