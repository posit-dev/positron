/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useEffect, useRef } from 'react';

import { ICommandService } from 'vs/platform/commands/common/commands';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IHoverService } from 'vs/platform/hover/browser/hover';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { ActionBar, kHeight as kActionBarHeight } from 'vs/workbench/contrib/positronConnections/browser/components/actionBar';

import { FixedSizeList as List } from 'react-window';

import 'vs/css!./positronConnections';
import { IPositronConnectionsService } from 'vs/workbench/services/positronConnections/browser/interfaces/positronConnectionsService';
import { IPositronConnectionItem } from 'vs/workbench/services/positronConnections/browser/interfaces/positronConnectionsInstance';
import { IReactComponentContainer } from 'vs/base/browser/positronReactRenderer';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { useStateRef } from 'vs/base/browser/ui/react/useStateRef';
import * as DOM from 'vs/base/browser/dom';

export interface PositronConnectionsProps {
	readonly commandService: ICommandService;
	readonly configurationService: IConfigurationService;
	readonly contextKeyService: IContextKeyService;
	readonly contextMenuService: IContextMenuService;
	readonly hoverService: IHoverService;
	readonly keybindingService: IKeybindingService;
	readonly connectionsService: IPositronConnectionsService;
	readonly reactComponentContainer: IReactComponentContainer;
}

export const PositronConnections = (props: React.PropsWithChildren<PositronConnectionsProps>) => {

	// There's probably a better way to trigger the re-render. Probably, an event the connections
	// service can fire and trigger re-rendering this component.
	const [, reRender] = React.useReducer((x) => x + 1, 0);

	// This allows us to introspect the size of the component. Which then allows
	// us to efficiently only render items that are in view.
	const [, setWidth] = React.useState(props.reactComponentContainer.width);
	const [height, setHeight] = React.useState(props.reactComponentContainer.height);

	useEffect(() => {
		const disposableStore = new DisposableStore();
		disposableStore.add(props.reactComponentContainer.onSizeChanged(size => {
			setWidth(size.width);
			setHeight(size.height);
		}));
		return () => disposableStore.dispose();
	});

	// We're required to save the scroll state because browsers will automatically
	// scrollTop when an object becomes visible again.
	const [, setScrollState, scrollStateRef] = useStateRef<number[] | undefined>(undefined);
	const innerRef = useRef<HTMLElement>(undefined!);
	useEffect(() => {
		const disposableStore = new DisposableStore();
		disposableStore.add(props.reactComponentContainer.onSaveScrollPosition(() => {
			if (innerRef.current) {
				setScrollState(DOM.saveParentsScrollTop(innerRef.current));
			}
		}));
		disposableStore.add(props.reactComponentContainer.onRestoreScrollPosition(() => {
			if (scrollStateRef.current) {
				if (innerRef.current) {
					DOM.restoreParentsScrollTop(innerRef.current, scrollStateRef.current);
				}
				setScrollState(undefined);
			}
		}));
		return () => disposableStore.dispose();
	});

	// For each connection we create the connection item, and
	// recursively for it's children, if they are expanded and have children
	// TODO: parent is currently a hack to ensure unique keys, but we should
	// be able to fix that with proper Id's that contain the element path.
	const getConnectionItems = (items: IPositronConnectionItem[], level = 0, parent = '') => {
		return items.reduce<PositronConnectionsItemProps[]>((elements, con, index) => {
			elements.push(
				{
					name: con.name(),
					icon: con.icon(),
					expanded: con.expanded(),
					onExpand: con.expanded() === undefined ? undefined : () => {
						if (con.onToggleExpandEmitter) {
							con.onToggleExpandEmitter.fire();
						}
						// We trigger a re-render when connection is expanded.
						reRender();
					},
					level: level,
					id: `${parent}-${level}-${index}`
				}
			);

			if (con.expanded() && con.getChildren) {
				elements.push(...getConnectionItems(con.getChildren(), level + 1, `${parent}-${index}`));
			}

			return elements;
		}, []);
	};

	const items = getConnectionItems(props.connectionsService.getConnections());

	const ItemEntry = (props: ItemEntryProps) => {
		return <PositronConnectionsItem {...items[props.index]} style={props.style}></PositronConnectionsItem>;
	};

	return (
		<div className='positron-connections'>
			<ActionBar {...props}></ActionBar>
			<div className='connections-items-container'>
				<List
					itemCount={items.length}
					itemSize={26}
					height={height - kActionBarHeight}
					width={'100%'}
					itemKey={index => items[index].id}
					innerRef={innerRef}
				>
					{ItemEntry}
				</List>
			</div>
		</div>
	);
};

interface ItemEntryProps {
	index: number;
	style: any;
}

interface PositronConnectionsItemProps {
	id: string;
	name: string;
	icon: string;
	expanded: boolean | undefined;
	onExpand?(): void;
	level: number; // How nested the item is.
	style?: any;
}

const PositronConnectionsItem = (props: React.PropsWithChildren<PositronConnectionsItemProps>) => {

	// If the connection is not expandable, we add some more padding.
	const padding = props.level * 10 + (props.expanded === undefined ? 26 : 0);

	return (
		<div className='connections-item' style={props.style}>
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
