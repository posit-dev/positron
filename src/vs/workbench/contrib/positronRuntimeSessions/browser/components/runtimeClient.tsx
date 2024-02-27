/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./runtimeClient';
import * as React from 'react';
import { useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { IRuntimeClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeClientInstance';
import { DisposableStore } from 'vs/base/common/lifecycle';

interface runtimeClientProps {
	readonly client: IRuntimeClientInstance<any, any>;
}

export const RuntimeClient = (props: runtimeClientProps) => {

	const [state, setState] = useState(props.client.getClientState());

	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Attach the handler for the onDidCreateClientInstance event, so we'll
		// update live when a client is created.
		disposableStore.add(props.client.onDidChangeClientState(state => {
			setState(state);
		}));

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, []);

	return <tr className='runtime-client'>
		<td>
			<div className='client-type'>{props.client.getClientType()}</div>
			<div className='client-id'>{props.client.getClientId()}</div>
		</td>
		<td>
			{state}
		</td>
	</tr>;
};
