/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useEffect, useState } from 'react';
import './positronConnections.css';
import { SchemaNavigation } from './components/schemaNavigation.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { PositronConnectionsContextProvider, PositronConnectionsServices } from './positronConnectionsContext.js';
import { ListConnections } from './components/listConnections.js';

export interface PositronConnectionsProps extends PositronConnectionsServices { }
export interface ViewsProps {
	readonly width: number;
	readonly height: number;
	readonly activeInstanceId: string | undefined;
	readonly setActiveInstanceId: (instanceId: string | undefined) => void;
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

	const [activeInstanceId, setActiveInstanceId] = useState<string>();
	const { connectionsService } = props;

	useEffect(() => {
		const disposableStore = new DisposableStore();
		disposableStore.add(connectionsService.onDidFocus(async (id) => {
			// The focus event might be sent before the connection is actually registered
			// with the service. So we try a few times to find the connection before giving up.
			// Initially we were waiting for just 500ms but that turned out to be too short
			// for the CI machines.
			for (let i = 0; i < 100; i++) {
				const con = connectionsService.getConnections().find(item => item.id === id);
				if (con && con.active) {
					setActiveInstanceId(id);
					return;
				}
				await new Promise(resolve => setTimeout(resolve, 50));
			}
			// Warn if a connection is not found so we can easily debug CI failures in the future.
			console.warn('Could not find connection with id', id);
		}));
		return () => disposableStore.dispose();
	}, [setActiveInstanceId, connectionsService]);

	const viewProps: ViewsProps = {
		width,
		height,
		activeInstanceId,
		setActiveInstanceId,
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
