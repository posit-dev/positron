/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useEffect, useRef, useState, MouseEvent } from 'react';

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
import { IReactComponentContainer } from 'vs/base/browser/positronReactRenderer';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { useStateRef } from 'vs/base/browser/ui/react/useStateRef';
import * as DOM from 'vs/base/browser/dom';
import { IPositronConnectionEntry } from 'vs/workbench/services/positronConnections/browser/positronConnectionsCache';

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

	// This allows us to introspect the size of the component. Which then allows
	// us to efficiently only render items that are in view.
	const [_, setWidth] = React.useState(props.reactComponentContainer.width);
	const [height, setHeight] = React.useState(props.reactComponentContainer.height);

	useEffect(() => {
		const disposableStore = new DisposableStore();
		disposableStore.add(props.reactComponentContainer.onSizeChanged(size => {
			setWidth(size.width);
			setHeight(size.height);
		}));
		return () => disposableStore.dispose();
	}, []);

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
	}, []);

	const [items, setItems] = useState<IPositronConnectionEntry[]>(props.connectionsService.getConnectionEntries);
	useEffect(() => {
		const disposableStore = new DisposableStore();
		disposableStore.add(props.connectionsService.onDidChangeEntries((entries) => {
			setItems(entries);
		}));
		props.connectionsService.refreshConnectionEntries();
		return () => disposableStore.dispose();
	}, []);

	const [selectedId, setSelectedId] = useState<string>();

	const ItemEntry = (props: ItemEntryProps) => {
		const itemProps = items[props.index];

		return (
			<PositronConnectionsItem
				name={itemProps.name}
				expanded={itemProps.expanded}
				onToggleExpandEmitter={itemProps.onToggleExpandEmitter}
				level={itemProps.level}
				id={itemProps.id}
				icon={itemProps.icon}
				kind={itemProps.kind}
				active={itemProps.active}
				selected={itemProps.id === selectedId}
				onSelectedHandler={() => setSelectedId(itemProps.id)}
				style={props.style}>
			</PositronConnectionsItem>
		);
	};

	return (
		<div className='positron-connections'>
			<ActionBar
				{...props}
				selectedEntry={items.find((item) => item.id === selectedId)}
			>
			</ActionBar>
			<div className='connections-items-container'>
				<List
					itemCount={items.length}
					itemSize={26}
					height={height - kActionBarHeight}
					width={'calc(100% - 2px)'}
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

interface PositronConnectionsItemProps extends IPositronConnectionEntry {
	style?: any;
	selected: boolean;
	onSelectedHandler: () => void;
}

const PositronConnectionsItem = (props: React.PropsWithChildren<PositronConnectionsItemProps>) => {

	// If the connection is not expandable, we add some more padding.
	const padding = props.level * 10 + (props.expanded === undefined ? 26 : 0);
	const handleExpand = () => {
		if (props.onToggleExpandEmitter) {
			props.onToggleExpandEmitter.fire();
		}
	};

	const [icon, setIcon] = useState(() => {
		if (props.kind) {
			switch (props.kind) {
				case 'table':
					return 'table';
				case 'field':
					return 'symbol-field';
				case 'database':
					return 'database';
				// TODO: handle other kinds suuch as schema, catalog, etc that are common
				// in other dbs. Will need to add our own codicons.
			}
		}
		// If kind is not known, then no icon is dplsayed by default.
		return '';
	});

	useEffect(() => {
		props.icon.then((i) => {
			console.log(i);
			if (i === undefined) {
				console.log('icon is undefined!');
				return;
			}
			setIcon(i);
		});
	}, []);

	const rowMouseDownHandler = (e: MouseEvent<HTMLElement>) => {
		// Consume the event.
		e.preventDefault();
		e.stopPropagation();

		// Handle the event.
		switch (e.button) {
			// Main button.
			case 0:
				// TODO: handle ctrl+ click, etc.
				props.onSelectedHandler();
				break;

			// Secondary button.
			case 2:
				// TODO: more options here
				props.onSelectedHandler();
				break;
		}
	};

	return (
		<div className={`connections-item ${props.selected ? 'selected' : ''}`} style={props.style}>
			<div className='nesting' style={{ width: `${padding}px` }}></div>
			{
				props.expanded === undefined ?
					<></> :
					<div
						className='expand-collapse-area'
						onClick={handleExpand}
						// Disable clicking when the connection is not active
						style={{ pointerEvents: props.active ? undefined : 'none' }}
					>
						<div
							className={`codicon codicon-chevron-${props.expanded ? 'down' : 'right'}`}
						>
						</div>
					</div>
			}
			<div
				className={`connections-name ${!props.active ? 'connection-disabled' : ''}`}
				onMouseDown={rowMouseDownHandler}
			>
				{props.name}
			</div>
			<div className={`connections-icon codicon codicon-${icon}`}></div>
		</div>
	);
};
