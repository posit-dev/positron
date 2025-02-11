/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './listConnections.css';

// React.
import React, { useState, useEffect, useRef, CSSProperties } from 'react';

// Other dependencies.
import { useStateRef } from '../../../../../base/browser/ui/react/useStateRef.js';
import * as DOM from '../../../../../base/browser/dom.js';
import { ActionBarButton } from '../../../../../platform/positronActionBar/browser/components/actionBarButton.js';
import { ActionBarRegion } from '../../../../../platform/positronActionBar/browser/components/actionBarRegion.js';
import { PositronActionBar } from '../../../../../platform/positronActionBar/browser/positronActionBar.js';
import { PositronActionBarContextProvider } from '../../../../../platform/positronActionBar/browser/positronActionBarContext.js';
import { ViewsProps } from '../positronConnections.js';
import { PositronConnectionsServices, usePositronConnectionsContext } from '../positronConnectionsContext.js';
import { FixedSizeList as List } from 'react-window';
import { positronClassNames } from '../../../../../base/common/positronUtilities.js';
import { languageIdToName } from './schemaNavigation.js';
import { IPositronConnectionInstance } from '../../../../services/positronConnections/common/interfaces/positronConnectionsInstance.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { showResumeConnectionModalDialog } from './resumeConnectionModalDialog.js';
import { localize } from '../../../../../nls.js';
import { showNewConnectionModalDialog } from './newConnectionModalDialog.js';

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
		const { language_id, name, icon } = itemProps.metadata;

		return (
			<div
				className={positronClassNames(
					'connections-list-item',
					{ 'selected': itemProps.id === selectedInstanceId }
				)}
				style={props.style}
				onMouseDown={() => setSelectedInstanceId(itemProps.id)}
			>
				<div className='col-icon'>
					{icon ? <img src={icon}></img> : <></>}
				</div>
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
				onDeleteConnection={
					selectedInstanceId ?
						() => {
							context.connectionsService.removeConnection(selectedInstanceId);
						} :
						undefined
				}
				onNewConnection={() => {
					showNewConnectionModalDialog(context);
				}}
			>
			</ActionBar>
			<div className='connections-list-container'>
				<div className='connections-list-header' style={{ height: `${TABLE_HEADER_HEIGHT}px` }}>
					<div className='col-icon'></div>
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
					height={height - ACTION_BAR_HEIGHT - TABLE_HEADER_HEIGHT}
					innerRef={innerRef}
					itemCount={instances.length}
					itemKey={index => instances[index].id}
					itemSize={26}
					width={'calc(100% - 2px)'}
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
	onDeleteConnection?: () => void;
	onNewConnection: () => void;
}

const ActionBar = (props: React.PropsWithChildren<ActionBarProps>) => {

	return (
		<div style={{ height: ACTION_BAR_HEIGHT }}>
			<PositronActionBarContextProvider {...props}>
				<PositronActionBar
					borderBottom={true}
					borderTop={true}
					paddingLeft={ACTION_BAR_PADDING_LEFT}
					paddingRight={ACTION_BAR_PADDING_RIGHT}
					size='small'
				>
					<ActionBarRegion location='left'>
						<ActionBarButton
							align='left'
							iconId='positron-new-connection'
							text={localize('positron.listConnections.newConnection', 'New Connection')}
							onPressed={() => {
								props.onNewConnection();
							}}
						/>
					</ActionBarRegion>
					<ActionBarRegion location='right'>
						<ActionBarButton
							align='right'
							disabled={props.onDeleteConnection === undefined}
							iconId='close'
							text={localize('positron.listConnections.deleteConnection', 'Delete Connection')}
							onPressed={props.onDeleteConnection}
						/>
					</ActionBarRegion>
				</PositronActionBar>
			</PositronActionBarContextProvider>
		</div>
	);
};
