/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import React from 'react';
import { ActionBarButton } from 'vs/platform/positronActionBar/browser/components/actionBarButton';
import { ActionBarRegion } from 'vs/platform/positronActionBar/browser/components/actionBarRegion';
import { ActionBarSearch } from 'vs/platform/positronActionBar/browser/components/actionBarSearch';
import { ActionBarSeparator } from 'vs/platform/positronActionBar/browser/components/actionBarSeparator';
import { PositronActionBar } from 'vs/platform/positronActionBar/browser/positronActionBar';
import { PositronActionBarContextProvider } from 'vs/platform/positronActionBar/browser/positronActionBarContext';
import { ViewsProps } from 'vs/workbench/contrib/positronConnections/browser/positronConnections';
import { PositronConnectionsServices, usePositronConnectionsContext } from 'vs/workbench/contrib/positronConnections/browser/positronConnectionsContext';
import { FixedSizeList as List } from 'react-window';
import 'vs/css!./listConnections';

export interface ListConnnectionsProps extends ViewsProps { }

export const ListConnections = (props: React.PropsWithChildren<ListConnnectionsProps>) => {
	const context = usePositronConnectionsContext();
	const { height, setActiveInstanceId } = props;
	const instances = props.items.filter(item => item.level === 0);

	const ItemEntry = (props: { index: number; style: any }) => {
		const itemProps = instances[props.index];

		return (
			<div
				style={props.style}
				onMouseDown={() => setActiveInstanceId(itemProps.id)}
			>
				{itemProps.name}
			</div>
		);
	};

	return (
		<div className='positron-connections-list'>
			<ActionBar {...context}></ActionBar>
			<div className='connections-items-container'>
				<div className='connections-list-header' style={{ height: `${26}px` }}>
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
			<div className='sash' style={{ left: '-2px', width: '4px' }}></div>
		</div>
	);
};


const ACTION_BAR_PADDING_LEFT = 8;
const ACTION_BAR_PADDING_RIGHT = 8;
const ACTION_BAR_HEIGHT = 32;

const ActionBar = (props: React.PropsWithChildren<PositronConnectionsServices>) => {

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
							tooltip={() => 'Connect'}
						/>
						<ActionBarSeparator />
						<ActionBarButton
							align='left'
							iconId='positron-disconnect-connection'
							text='Disconnect'
						/>
						<ActionBarSeparator />
						<ActionBarButton
							align='left'
							iconId='refresh'
						/>
						<ActionBarSeparator />
						<ActionBarButton
							align='left'
							iconId='clear-all'
						/>
					</ActionBarRegion>
					<ActionBarRegion location='right'>
						<div className='action-bar-disabled'>
							<ActionBarSearch placeholder='filter'></ActionBarSearch>
						</div>
					</ActionBarRegion>
				</PositronActionBar>
			</PositronActionBarContextProvider>
		</div>
	);
};
