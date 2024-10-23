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
import { ActionBar, ACTION_BAR_HEIGHT as kActionBarHeight } from 'vs/workbench/contrib/positronConnections/browser/components/actionBar';

import { FixedSizeList as List } from 'react-window';

import 'vs/css!./positronConnections';
import { IPositronConnectionsService } from 'vs/workbench/services/positronConnections/browser/interfaces/positronConnectionsService';
import { IReactComponentContainer } from 'vs/base/browser/positronReactRenderer';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { useStateRef } from 'vs/base/browser/ui/react/useStateRef';
import * as DOM from 'vs/base/browser/dom';
import { IPositronConnectionEntry } from 'vs/workbench/services/positronConnections/browser/positronConnectionsCache';
import { positronClassNames } from 'vs/base/common/positronUtilities';

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
	}, [props.reactComponentContainer]);

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
	}, [props.reactComponentContainer, scrollStateRef, setScrollState]);

	const [items, setItems] = useState<IPositronConnectionEntry[]>(props.connectionsService.getConnectionEntries);
	useEffect(() => {
		const disposableStore = new DisposableStore();
		disposableStore.add(props.connectionsService.onDidChangeEntries((entries) => {
			setItems(entries);
		}));
		// First entries refresh - on component mount.
		props.connectionsService.refreshConnectionEntries();
		return () => disposableStore.dispose();
	}, [props.connectionsService]);

	const [selectedId, setSelectedId] = useState<string>();

	const ItemEntry = (props: ItemEntryProps) => {
		const itemProps = items[props.index];

		return (
			<PositronConnectionsItem
				item={itemProps}
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
				clearAllHandler={() => props.connectionsService.clearAllConnections()}
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

interface PositronConnectionsItemProps {
	item: IPositronConnectionEntry;
	style?: any;
	selected: boolean;

	/**
	 * What happens when a row is selected?
	 */
	onSelectedHandler: () => void;
}

const PositronConnectionsItem = (props: React.PropsWithChildren<PositronConnectionsItemProps>) => {

	// If the connection is not expandable, we add some more padding.
	const padding = props.item.level * 10 + (props.item.expanded === undefined ? 26 : 0);
	const handleExpand = () => {
		if (props.item.onToggleExpandEmitter) {
			props.item.onToggleExpandEmitter.fire();
		}
	};

	const icon = (() => {

		if (props.item.icon) {
			return props.item.icon;
		}

		if (props.item.kind) {
			// TODO: we'll probably want backends to implement the casting to a set of known
			// types or provide their own icon.
			switch (props.item.kind) {
				case 'table':
					return 'positron-table-connection';
				case 'view':
					return 'positron-view-connection';
				case 'database':
					return 'positron-database-connection';
				case 'schema':
					return 'positron-schema-connection';
				case 'catalog':
					return 'positron-catalog-connection';
				case 'field':
					switch (props.item.dtype) {
						case 'character':
							return 'positron-data-type-string';
						case 'integer':
						case 'numeric':
							return 'positron-data-type-number';
						case 'boolean':
						case 'bool':
							return 'positron-data-type-boolean';
						default:
							return 'positron-data-type-unknown';
					}
			}
		}
		// If kind is not known, then no icon is dplsayed by default.
		return '';
	})();

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
		<div
			className={positronClassNames(
				'connections-item',
				{ 'selected': props.selected }
			)}
			style={props.style}
		>
			<div className='nesting' style={{ width: `${padding}px` }}></div>
			{
				props.item.expanded === undefined ?
					<></> :
					<div
						className='expand-collapse-area'
						onClick={handleExpand}
						// Disable clicking when the connection is not active
						style={{ pointerEvents: props.item.active ? undefined : 'none' }}
					>
						<div
							className={`codicon codicon-chevron-${props.item.expanded ? 'down' : 'right'}`}
						>
						</div>
					</div>
			}
			<div
				className={`connections-details ${!props.item.active ? 'connection-disabled' : ''}`}
				onMouseDown={rowMouseDownHandler}
			>
				<span className='connections-name'>{props.item.name}</span>
				{
					props.item.language_id ?
						<span className='connections-language'>{languageIdToName(props.item.language_id)}</span> :
						<></>
				}
				{
					props.item.dtype ?
						<span className='connections-dtype'>{props.item.dtype}</span> :
						<></>
				}
				{
					props.item.error ?
						<span className='connections-error codicon codicon-error' title={props.item.error}></span> :
						<></>
				}
			</div>
			<div
				className={positronClassNames(
					'connections-icon',
					'codicon',
					`codicon-${icon}`,
					{ 'disabled': props.item.preview === undefined }
				)}
				onClick={() => props.item.preview?.()}
			>
			</div>
		</div>
	);
};

function languageIdToName(id: string) {
	switch (id) {
		case 'python':
			return 'Python';
		case 'r':
			return 'R';
		default:
			return id;
	}
}
