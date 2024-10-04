/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';

import { ICommandService } from 'vs/platform/commands/common/commands';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IHoverService } from 'vs/platform/hover/browser/hover';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { ActionBar } from 'vs/workbench/contrib/positronConnections/browser/components/actionBar';

import 'vs/css!./positronConnections';

export interface PositronConnectionsProps {
	readonly commandService: ICommandService;
	readonly configurationService: IConfigurationService;
	readonly contextKeyService: IContextKeyService;
	readonly contextMenuService: IContextMenuService;
	readonly hoverService: IHoverService;
	readonly keybindingService: IKeybindingService;
}

export const PositronConnections = (props: React.PropsWithChildren<PositronConnectionsProps>) => {
	return (
		<div className='positron-connections'>
			<ActionBar {...props}></ActionBar>
			<div className='connections-items-container'>
				<PositronConnectionsItem
					name='SQLite Connection 1'
					icon='database'
				></PositronConnectionsItem>
				<PositronConnectionsItem
					name='SQLite Connection 2'
					icon='database'
				></PositronConnectionsItem>
			</div>
		</div>
	);
};

interface PositronConnectionsItemProps {
	name: string;
	icon: string;
}

const PositronConnectionsItem = (props: React.PropsWithChildren<PositronConnectionsItemProps>) => {
	return (
		<div className='connections-item'>
			<div className='expand-collapse-area'>
				<div className='codicon codicon-chevron-right'></div>
			</div>
			<div className='connections-name'>
				{props.name}
			</div>
			<div className={`connections-icon codicon codicon-${props.icon}`}>
			</div>
		</div>
	);
};
