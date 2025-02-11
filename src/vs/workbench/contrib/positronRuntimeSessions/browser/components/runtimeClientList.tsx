/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './runtimeClientList.css';

// React.
import React, { useEffect, useState } from 'react';

// Other dependencies.
import { RuntimeClient } from './runtimeClient.js';
import { ILanguageRuntimeSession } from '../../../../services/runtimeSession/common/runtimeSessionService.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';

interface runtimeClientListProps {
	readonly session: ILanguageRuntimeSession;
}

/**
 * A component that shows a table of active runtime clients (comms) currently
 * connected to a Positron runtime session.
 *
 * @param props The runtimeClientListProps that contains the component properties.
 *
 * @returns The rendered component.
 */
export const RuntimeClientList = (props: runtimeClientListProps) => {

	const [clients, setClients] = useState(props.session.clientInstances);

	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Attach the handler for the onDidCreateClientInstance event, so we'll
		// update live when a client is created.
		disposableStore.add(props.session.onDidCreateClientInstance(client => {
			setClients([...clients, client.client]);
		}));

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, [clients, props.session]);

	return <div className='runtime-client-list'>
		<table>
			<tbody>
				{props.session.clientInstances.map(client => {
					return <RuntimeClient key={client.getClientId()} client={client} />;
				})}
			</tbody>
		</table>
	</div>;
};
