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

	// There's probably a better way to trigger the re-render. Probably, an event the connections
	// service can fire and trigger re-rendering this component.
	const [, reRender] = React.useReducer((x) => x + 1, 0);

	// For each connection we generate the connection item, and
	// recursively for it's children, if they are expanded and have children
	// TODO: parent is currently a hack to ensure unique keys, but we should
	// be able to fix that with proper Id's that contain the element path.
	const renderConnectionItems = (items: IPositronConnectionItem[], level = 0, parent = '') => {
		return items.reduce<JSX.Element[]>((elements, con, index) => {
			elements.push(
				<PositronConnectionsItem
					key={`${con.name()}-${level}-${parent}-${index}`}
					name={con.name()}
					icon={con.icon()}
					expanded={con.expanded()}
					onExpand={con.expanded() === undefined ? undefined : () => {
						if (con.onToggleExpandEmitter) {
							con.onToggleExpandEmitter.fire();
						}
						// We trigger a re-render when connection is expanded.
						reRender();
					}}
					level={level}
				>
				</PositronConnectionsItem>
			);

			if (con.expanded() && con.getChildren) {
				elements.push(...renderConnectionItems(con.getChildren(), level + 1, `${parent}-${index}`));
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
	onExpand?(): void;
	level: number; // How nested the item is.
}

const PositronConnectionsItem = (props: React.PropsWithChildren<PositronConnectionsItemProps>) => {

	// If the connection is not expandable, we add some more padding.
	const padding = props.level * 10 + (props.expanded === undefined ? 26 : 0);

	return (
		<div className='connections-item'>
			<div className='nesting' style={{ width: `${padding}px` }}></div>
			{
				props.expanded === undefined ?
					<></> :
					<div className='expand-collapse-area' onClick={props.onExpand}>
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
