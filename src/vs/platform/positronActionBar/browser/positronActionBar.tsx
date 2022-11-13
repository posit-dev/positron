/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronActionBar';
import * as React from 'react';
import { PropsWithChildren } from 'react'; // eslint-disable-line no-duplicate-imports
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';

/**
 * PositronActionBarServices interface. Defines the set of services that are required by a Positron action bar.
 */
export interface PositronActionBarServices {
	commandService: ICommandService;
	configurationService: IConfigurationService;
	contextKeyService: IContextKeyService;
	contextMenuService: IContextMenuService;
	keybindingService: IKeybindingService;
}

/**
 * PositronActionBarProps interface.
 */
interface PositronActionBarProps extends PositronActionBarServices { }

/**
 * PositronActionBar component.
 * @param props A PositronActionBarProps that contains the component properties.
 */
export const PositronActionBar = (props: PropsWithChildren<PositronActionBarProps>) => {
	return (
		<div className='positron-action-bar'>
			{props.children}
		</div>
	);
};
