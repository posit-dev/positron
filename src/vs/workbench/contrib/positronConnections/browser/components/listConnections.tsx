/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useState, useEffect } from 'react';
import { ActionBarButton } from 'vs/platform/positronActionBar/browser/components/actionBarButton';
import { ActionBarRegion } from 'vs/platform/positronActionBar/browser/components/actionBarRegion';
import { ActionBarSearch } from 'vs/platform/positronActionBar/browser/components/actionBarSearch';
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

	const [selectedInstanceId, setSelectedInstanceId] = useState<string | undefined>(undefined);

	const ItemEntry = (props: { index: number; style: any }) => {
		const itemProps = instances[props.index];

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
				<div className='col-name'>{itemProps.name}</div>
				<div className='col-language'>
					{itemProps.language_id ? languageIdToName(itemProps.language_id) : ''}
				</div>
				<div
					className={positronClassNames('col-status', { 'disabled': !itemProps.active })}
				>
					{itemProps.active ? 'Connected' : 'Disconected'}
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
				<div className='connections-list-header' style={{ height: `${24}px` }}>
					<div className='col-icon' style={{ width: `${26}px` }}></div>
					<VerticalSplitter />
					<div className='col-name'>Connection</div>
					<VerticalSplitter />
					<div className='col-language'>Language</div>
					<VerticalSplitter />
					<div className='col-status'>Status</div>
					<VerticalSplitter />
					<div className='col-action' style={{ width: `${26}px` }}></div>
				</div>
				<List
					itemCount={instances.length}
					itemSize={26}
					height={height - ACTION_BAR_HEIGHT}
					width={'calc(100% - 2px)'}
					itemKey={index => instances[index].id}
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
							tooltip={() => 'New Connection'}
							text='New Connection'
							disabled={true}
						/>
					</ActionBarRegion>
					<ActionBarRegion location='right'>
						<ActionBarButton
							align='right'
							iconId='close'
							tooltip={() => 'Delete Connection'}
							text='Delete Connection'
							disabled={props.deleteConnectionHandler === undefined}
							onPressed={props.deleteConnectionHandler}
						/>
						<div className='action-bar-disabled'>
							<ActionBarSearch placeholder='filter'></ActionBarSearch>
						</div>
					</ActionBarRegion>
				</PositronActionBar>
			</PositronActionBarContextProvider>
		</div>
	);
};
