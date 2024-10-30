/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useEffect, useRef, useState, MouseEvent } from 'react';
import { useStateRef } from 'vs/base/browser/ui/react/useStateRef';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { usePositronConnectionsContext } from 'vs/workbench/contrib/positronConnections/browser/positronConnectionsContext';
import * as DOM from 'vs/base/browser/dom';
import { IPositronConnectionEntry } from 'vs/workbench/services/positronConnections/browser/positronConnectionsUtils';
import { ActionBar, ACTION_BAR_HEIGHT as kActionBarHeight } from 'vs/workbench/contrib/positronConnections/browser/components/schemaNavigationActionBar';
import { FixedSizeList as List } from 'react-window';
import { positronClassNames } from 'vs/base/common/positronUtilities';
import 'vs/css!./schemaNavigation';
import { ViewsProps } from 'vs/workbench/contrib/positronConnections/browser/positronConnections';

export interface SchemaNavigationProps extends ViewsProps { }

export const SchemaNavigation = (props: React.PropsWithChildren<SchemaNavigationProps>) => {

	const context = usePositronConnectionsContext();
	const { height, activeInstanceId, setActiveInstanceId } = props;

	// We're required to save the scroll state because browsers will automatically
	// scrollTop when an object becomes visible again.
	const [, setScrollState, scrollStateRef] = useStateRef<number[] | undefined>(undefined);
	const innerRef = useRef<HTMLElement>(undefined!);
	useEffect(() => {
		const disposableStore = new DisposableStore();
		disposableStore.add(context.reactComponentContainer.onSaveScrollPosition(() => {
			if (innerRef.current) {
				setScrollState(DOM.saveParentsScrollTop(innerRef.current));
			}
		}));
		disposableStore.add(context.reactComponentContainer.onRestoreScrollPosition(() => {
			if (scrollStateRef.current) {
				if (innerRef.current) {
					DOM.restoreParentsScrollTop(innerRef.current, scrollStateRef.current);
				}
				setScrollState(undefined);
			}
		}));
		return () => disposableStore.dispose();
	}, [context.reactComponentContainer, scrollStateRef, setScrollState]);

	const [selectedId, setSelectedId] = useState<string>();
	const activeInstance = context.connectionsService.getConnections().find(item => item.id === activeInstanceId);

	const [entries, setEntries] = useState<IPositronConnectionEntry[]>(activeInstance?.getEntries() || []);

	useEffect(() => {
		if (!activeInstance) {
			return;
		}
		const disposableStore = new DisposableStore();

		disposableStore.add(activeInstance.onDidChangeEntries((entries) => {
			setEntries(entries);
		}));

		disposableStore.add(activeInstance.onDidChangeStatus((active) => {
			if (!active) {
				setActiveInstanceId(undefined);
			}
		}));

		activeInstance.refreshEntries();
		return () => disposableStore.dispose();
	}, [activeInstance, setActiveInstanceId]);

	if (!activeInstance) {
		// This should not be possible, the active instance must exist.
		return (
			<div className='positron-connections-schema-navigation'>
				<ActionBar
					{...context}
					disconnectHandler={() => { }}
					refreshHandler={() => { }}
					backHandler={() => props.setActiveInstanceId(undefined)}
				>
				</ActionBar>
			</div>
		);
	}

	const toggleExpandHandler = (id: string) => {
		activeInstance.onToggleExpandEmitter.fire(id);
	};

	const ItemEntry = (props: ItemEntryProps) => {
		const itemProps = entries[props.index];

		return (
			<PositronConnectionsItem
				item={itemProps}
				selected={itemProps.id === selectedId}
				onSelectedHandler={() => setSelectedId(itemProps.id)}
				onToggleExpandHandler={toggleExpandHandler}
				style={props.style}>
			</PositronConnectionsItem>
		);
	};

	const { name, language_id, icon } = activeInstance.metadata;

	return (
		<div className='positron-connections-schema-navigation'>
			<ActionBar
				{...context}
				disconnectHandler={() => activeInstance.disconnect?.()}
				refreshHandler={() => activeInstance.refresh?.()}
				backHandler={() => props.setActiveInstanceId(undefined)}
			>
			</ActionBar>
			<div className='connections-items-container'>
				<div className={'connections-instance-details'} style={{ height: kActionBarHeight - 6 }}>
					<div className='connection-name'>{name}</div>
					<div className='connection-language'>{languageIdToName(language_id)}</div>
					<div className={'connection-icon'}>
						{
							icon || <div className='codicon codicon-positron-database-connection'></div>
						}
					</div>
				</div>
				<List
					itemCount={entries.length}
					itemSize={26}
					/* size if the actionbar and the secondary side bar combined) */
					height={height - kActionBarHeight - (kActionBarHeight - 6)}
					width={'calc(100% - 2px)'}
					itemKey={index => entries[index].id}
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

	/**
	 * On toggle expand handler
	 */
	onToggleExpandHandler(id: string): void;
}

const PositronConnectionsItem = (props: React.PropsWithChildren<PositronConnectionsItemProps>) => {

	// If the connection is not expandable, we add some more padding.
	const padding = props.item.level * 10 + (props.item.expanded === undefined ? 26 : 0);
	const handleExpand = () => {
		props.onToggleExpandHandler(props.item.id);
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
					>
						<div
							className={`codicon codicon-chevron-${props.item.expanded ? 'down' : 'right'}`}
						>
						</div>
					</div>
			}
			<div
				className='connections-details'
				onMouseDown={rowMouseDownHandler}
			>
				<span className='connections-name'>{props.item.name}</span>
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
				className='connections-icon'
				onClick={() => props.item.preview?.()}
			>
				<div
					className={positronClassNames(
						'codicon',
						`codicon-${icon}`,
						{ 'disabled': props.item.preview === undefined }
					)}
				>
				</div>
			</div>
		</div>
	);
};

export function languageIdToName(id?: string) {

	if (!id) {
		return '';
	}

	switch (id) {
		case 'python':
			return 'Python';
		case 'r':
			return 'R';
		default:
			return id;
	}
}
