/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useState, useEffect, useRef, CSSProperties } from 'react';
import { useStateRef } from 'vs/base/browser/ui/react/useStateRef';
import * as DOM from 'vs/base/browser/dom';
import { ActionBarButton } from 'vs/platform/positronActionBar/browser/components/actionBarButton';
import { ActionBarRegion } from 'vs/platform/positronActionBar/browser/components/actionBarRegion';
import { PositronActionBar } from 'vs/platform/positronActionBar/browser/positronActionBar';
import { PositronActionBarContextProvider } from 'vs/platform/positronActionBar/browser/positronActionBarContext';
import { ViewsProps } from 'vs/workbench/contrib/positronConnections/browser/positronConnections';
import { PositronConnectionsServices, usePositronConnectionsContext } from 'vs/workbench/contrib/positronConnections/browser/positronConnectionsContext';
import { FixedSizeList as List } from 'react-window';
import 'vs/css!./listConnections';
import { positronClassNames } from 'vs/base/common/positronUtilities';
import { languageIdToName } from 'vs/workbench/contrib/positronConnections/browser/components/schemaNavigation';
import { IPositronConnectionInstance } from 'vs/workbench/services/positronConnections/browser/interfaces/positronConnectionsInstance';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { showResumeConnectionModalDialog } from 'vs/workbench/contrib/positronConnections/browser/components/resumeConnectionModalDialog';
import { localize } from 'vs/nls';

export interface ListConnnectionsProps extends ViewsProps { }

export const ListConnections = (props: React.PropsWithChildren<ListConnnectionsProps>) => {

	const context = usePositronConnectionsContext();
	const { height, setActiveInstanceId } = props;

	const [instances, setInstances] = useState<IPositronConnectionInstance[]>(context.connectionsService.getConnections);
	useEffect(() => {
		const disposableStore = new DisposableStore();
		disposableStore.add(context.connectionsService.onDidChangeConnections((connections) => {
			// Makes sure react recognises changes as this is a new array
			setInstances([...connections]);
		}));
		return () => disposableStore.dispose();
	}, [context.connectionsService]);

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

	const [selectedInstanceId, setSelectedInstanceId] = useState<string | undefined>(undefined);

	const ItemEntry = (props: { index: number; style: CSSProperties }) => {
		const itemProps = instances[props.index];
		const { language_id, name } = itemProps.metadata;

		return (
			<div
				style={props.style}
				className={positronClassNames(
					'connections-list-item',
					{ 'selected': itemProps.id === selectedInstanceId }
				)}
				onMouseDown={() => setSelectedInstanceId(itemProps.id)}
			>
				<div className='col-icon' style={{ width: `${26}px` }}></div>
				<div className='col-name'>{name}</div>
				<div className='col-language'>
					{language_id ? languageIdToName(language_id) : ''}
				</div>
				<div
					className={positronClassNames('col-status', { 'disabled': !itemProps.active })}
				>
					{
						itemProps.active ?
							localize('positron.listConnections.connected', 'Connected') :
							localize('positron.listConnections.disconnected', 'Disconnected')
					}
				</div>
				<div
					className='col-action' style={{ width: `${26}px` }}
					onMouseDown={() => {
						if (itemProps.active) {
							setActiveInstanceId(itemProps.id);
						} else {
							showResumeConnectionModalDialog(context, itemProps.id, setActiveInstanceId);
						}
					}}
				>
					<div
						className={`codicon codicon-arrow-circle-right`}
					>
					</div>
				</div>
			</div>
		);
	};

	const TABLE_HEADER_HEIGHT = 24;

	return (
		<div className='positron-connections-list'>
			<ActionBar
				{...context}
				deleteConnectionHandler={
					selectedInstanceId ?
						() => {
							context.connectionsService.removeConnection(selectedInstanceId);
						} :
						undefined
				}
			>
			</ActionBar>
			<div className='connections-list-container'>
				<div className='connections-list-header' style={{ height: `${TABLE_HEADER_HEIGHT}px` }}>
					<div className='col-icon' style={{ width: `${26}px` }}></div>
					<VerticalSplitter />
					<div className='col-name'>
						{localize('positron.listConnections.connection', 'Connection')}
					</div>
					<VerticalSplitter />
					<div className='col-language'>
						{localize('positron.listConnections.language', 'Language')}
					</div>
					<VerticalSplitter />
					<div className='col-status'>
						{localize('positron.listConnections.status', 'Status')}
					</div>
					<VerticalSplitter />
					<div className='col-action' style={{ width: `${26}px` }}></div>
				</div>
				<List
					itemCount={instances.length}
					itemSize={26}
					height={height - ACTION_BAR_HEIGHT - TABLE_HEADER_HEIGHT}
					width={'calc(100% - 2px)'}
					itemKey={index => instances[index].id}
					innerRef={innerRef}
				>
					{ItemEntry}
				</List>
			</div>
		</div>
	);
};

const VerticalSplitter = () => {
	return (
		<div className='vertical-splitter' style={{ width: '1px' }}>
			<div className='sash' style={{ left: '-2px', width: '4px', cursor: 'auto' }}></div>
		</div>
	);
};


const ACTION_BAR_PADDING_LEFT = 8;
const ACTION_BAR_PADDING_RIGHT = 8;
const ACTION_BAR_HEIGHT = 32;

interface ActionBarProps extends PositronConnectionsServices {
	deleteConnectionHandler?: () => void;
}

const ActionBar = (props: React.PropsWithChildren<ActionBarProps>) => {

	return (
		<div style={{ height: ACTION_BAR_HEIGHT }}>
			<PositronActionBarContextProvider {...props}>
				<PositronActionBar
					size='small'
					borderTop={true}
					borderBottom={true}
					paddingLeft={ACTION_BAR_PADDING_LEFT}
					paddingRight={ACTION_BAR_PADDING_RIGHT}
				>
					<ActionBarRegion location='left'>
						<ActionBarButton
							align='left'
							iconId='positron-new-connection'
							text={localize('positron.listConnections.newConnection', 'New Connection')}
							disabled={true}
						/>
					</ActionBarRegion>
					<ActionBarRegion location='right'>
						<ActionBarButton
							align='right'
							iconId='close'
							text={localize('positron.listConnections.deleteConnection', 'Delete Connection')}
							disabled={props.deleteConnectionHandler === undefined}
							onPressed={props.deleteConnectionHandler}
						/>
					</ActionBarRegion>
				</PositronActionBar>
			</PositronActionBarContextProvider>
		</div>
	);
};
