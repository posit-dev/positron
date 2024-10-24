/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useEffect, useState } from 'react';
import 'vs/css!./positronConnections';
import { SchemaNavigation } from 'vs/workbench/contrib/positronConnections/browser/components/schemaNavigation';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { PositronConnectionsContextProvider, PositronConnectionsServices } from 'vs/workbench/contrib/positronConnections/browser/positronConnectionsContext';
import { ListConnections } from 'vs/workbench/contrib/positronConnections/browser/components/listConnections';
import { IPositronConnectionEntry } from 'vs/workbench/services/positronConnections/browser/positronConnectionsCache';

export interface PositronConnectionsProps extends PositronConnectionsServices { }
export interface ViewsProps {
	readonly width: number;
	readonly height: number;
	readonly activeInstanceId: string | undefined;
	readonly setActiveInstanceId: (instanceId: string | undefined) => void;
	readonly items: IPositronConnectionEntry[];
}

export const PositronConnections = (props: React.PropsWithChildren<PositronConnectionsProps>) => {

	// This allows us to introspect the size of the component. Which then allows
	// us to efficiently only render items that are in view.
	const [width, setWidth] = React.useState(props.reactComponentContainer.width);
	const [height, setHeight] = React.useState(props.reactComponentContainer.height);

	useEffect(() => {
		const disposableStore = new DisposableStore();
		disposableStore.add(props.reactComponentContainer.onSizeChanged(size => {
			setWidth(size.width);
			setHeight(size.height);
		}));
		return () => disposableStore.dispose();
	}, [props.reactComponentContainer]);

	// For now we have a single flat cache that we filter differently based on what we want to show.
	// For instance, the list connections page will only show the items for which level == 0.
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

	const [activeInstanceId, setActiveInstanceId] = useState<string>();

	const viewProps: ViewsProps = {
		width,
		height,
		activeInstanceId,
		setActiveInstanceId,
		items
	};

	return (
		<div className='positron-connections'>
			<PositronConnectionsContextProvider {...props}>
				{
					// If no instance is active, just show the list of connections.
					// Otherwise, show the schema navigation.
					activeInstanceId === undefined ?
						<ListConnections {...viewProps}></ListConnections> :
						<SchemaNavigation {...viewProps}></SchemaNavigation>
				}
			</PositronConnectionsContextProvider>
		</div>
	);
};
