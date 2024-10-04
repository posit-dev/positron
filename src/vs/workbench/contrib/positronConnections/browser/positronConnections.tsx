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
import { IPositronConnectionsService } from 'vs/workbench/services/positronConnections/browser/interfaces/positronConnectionsService';
import { IPositronConnectionItem } from 'vs/workbench/services/positronConnections/browser/interfaces/positronConnectionsInstance';

export interface PositronConnectionsProps {
	readonly commandService: ICommandService;
	readonly configurationService: IConfigurationService;
	readonly contextKeyService: IContextKeyService;
	readonly contextMenuService: IContextMenuService;
	readonly hoverService: IHoverService;
	readonly keybindingService: IKeybindingService;
	readonly connectionsService: IPositronConnectionsService;
}

export const PositronConnections = (props: React.PropsWithChildren<PositronConnectionsProps>) => {

	// For each connection we generate the connection item, and
	// recursively for it's children, if they are expanded and have children
	const renderConnectionItems = (items: IPositronConnectionItem[], level = 0) => {
		return items.reduce<JSX.Element[]>((elements, con) => {
			elements.push(
				<PositronConnectionsItem
					key={con.name()}
					name={con.name()}
					icon={con.icon()}
					expanded={con.expanded()}
					level={level}
				>
				</PositronConnectionsItem>
			);

			if (con.expanded()) {
				elements.push(...renderConnectionItems(con.getChildren(), level + 1));
			}

			return elements;
		}, []);
	};

	return (
		<div className='positron-connections'>
			<ActionBar {...props}></ActionBar>
			<div className='connections-items-container'>
				{

					renderConnectionItems(props.connectionsService.getConnections())
				}
			</div>
		</div>
	);
};

interface PositronConnectionsItemProps {
	name: string;
	icon: string;
	expanded: boolean | undefined;
	level: number; // How nested the item is.
}

const PositronConnectionsItem = (props: React.PropsWithChildren<PositronConnectionsItemProps>) => {

	// If the connection is not expandable, we add some more padding.
	const padding = props.level * 10 + (props.expanded ? 26 : 0);

	return (
		<div className='connections-item'>
			<div className='nesting' style={{ width: `${padding}px` }}></div>
			{
				props.expanded === undefined ?
					<></> :
					<div className='expand-collapse-area'>
						<div
							className={`codicon codicon-chevron-${props.expanded ? 'down' : 'right'}`}
						>
						</div>
					</div>
			}
			<div className='connections-name'>
				{props.name}
			</div>
			<div className={`connections-icon codicon codicon-${props.icon}`}>
			</div>
		</div>
	);
};
