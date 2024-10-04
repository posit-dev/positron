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
					name='Snowflake Connection 1: R'
					icon='database'
					expanded={ConnectionItemExpanded.Expanded}
					level={0}
				></PositronConnectionsItem>
				<PositronConnectionsItem
					name='Snowflake Connection 2: Python'
					icon='database'
					expanded={ConnectionItemExpanded.Expanded}
					level={0}
				></PositronConnectionsItem>
				<PositronConnectionsItem
					name='PostgreSQL Connection: Python'
					icon='database'
					expanded={ConnectionItemExpanded.Expanded}
					level={0}
				></PositronConnectionsItem>
				<PositronConnectionsItem
					name='rds'
					icon='database'
					expanded={ConnectionItemExpanded.Expanded}
					level={1}
				></PositronConnectionsItem>
				<PositronConnectionsItem
					name='content'
					icon='database'
					expanded={ConnectionItemExpanded.Expanded}
					level={2}
				></PositronConnectionsItem>
				<PositronConnectionsItem
					name='bike_model_data'
					icon='database'
					expanded={ConnectionItemExpanded.NotExpanded}
					level={3}
				></PositronConnectionsItem>
				<PositronConnectionsItem
					name='bike_predict_metrics'
					icon='database'
					expanded={ConnectionItemExpanded.NotExpanded}
					level={3}
				></PositronConnectionsItem>
				<PositronConnectionsItem
					name='bike_raw_data'
					icon='database'
					expanded={ConnectionItemExpanded.NotExpanded}
					level={3}
				></PositronConnectionsItem>
				<PositronConnectionsItem
					name='bike_raw_dataset'
					icon='database'
					expanded={ConnectionItemExpanded.NotExpanded}
					level={3}
				></PositronConnectionsItem>
				<PositronConnectionsItem
					name='bike_station_info'
					icon='database'
					expanded={ConnectionItemExpanded.Expanded}
					level={3}
				></PositronConnectionsItem>
				<PositronConnectionsItem
					name='station_id'
					icon='database'
					expanded={ConnectionItemExpanded.None}
					level={4}
				></PositronConnectionsItem>
				<PositronConnectionsItem
					name='name'
					icon='database'
					expanded={ConnectionItemExpanded.None}
					level={4}
				></PositronConnectionsItem>
				<PositronConnectionsItem
					name='lat'
					icon='database'
					expanded={ConnectionItemExpanded.None}
					level={4}
				></PositronConnectionsItem>
				<PositronConnectionsItem
					name='lon'
					icon='database'
					expanded={ConnectionItemExpanded.None}
					level={4}
				></PositronConnectionsItem>
				<PositronConnectionsItem
					name='bike_test_data'
					icon='database'
					expanded={ConnectionItemExpanded.NotExpanded}
					level={3}
				></PositronConnectionsItem>
				<PositronConnectionsItem
					name='Spark Connection: Python'
					icon='database'
					expanded={ConnectionItemExpanded.NotExpanded}
					level={0}
				></PositronConnectionsItem>
			</div>
		</div>
	);
};

enum ConnectionItemExpanded {
	Expanded,
	NotExpanded,
	None
}

interface PositronConnectionsItemProps {
	name: string;
	icon: string;
	expanded: ConnectionItemExpanded;
	level: number; // How nested the item is.
}

const PositronConnectionsItem = (props: React.PropsWithChildren<PositronConnectionsItemProps>) => {

	// If the connection is not expandable, we add some more padding.
	const padding = props.level * 10 + (props.expanded === ConnectionItemExpanded.None ? 26 : 0);

	return (
		<div className='connections-item'>
			<div className='nesting' style={{ width: `${padding}px` }}></div>
			{
				props.expanded === ConnectionItemExpanded.None ?
					<></> :
					<div className='expand-collapse-area'>
						<div
							className={`codicon codicon-chevron-${props.expanded === ConnectionItemExpanded.Expanded ? 'down' : 'right'}`}
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
