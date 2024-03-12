/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./runtimeClientList';
import * as React from 'react';
import { useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { RuntimeClient } from 'vs/workbench/contrib/positronRuntimeSessions/browser/components/runtimeClient';
import { ILanguageRuntimeSession } from 'vs/workbench/services/runtimeSession/common/runtimeSessionService';
import { DisposableStore } from 'vs/base/common/lifecycle';

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
	}, []);

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
