/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './runtimeClient.css';

// React.
import React, { useEffect, useState } from 'react';

// Other dependencies.
import { IRuntimeClientInstance, RuntimeClientState } from '../../../../services/languageRuntime/common/languageRuntimeClientInstance.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { Event } from '../../../../../base/common/event.js';

interface runtimeClientProps {
	readonly client: IRuntimeClientInstance<any, any>;
}

/**
 * A component that displays one row in the table of runtime clients (comms)
 * currently connected to a Positron runtime session.
 *
 * @param props The runtimeClientProps that contains the component properties.
 *
 * @returns The rendered component.
 */
export const RuntimeClient = (props: runtimeClientProps) => {

	const [state, setState] = useState(props.client.clientState.get());
	const [counter, setCounter] = useState(props.client.messageCounter.get());

	const disconnect = (e: React.MouseEvent<HTMLAnchorElement>) => {
		e.preventDefault();
		props.client.dispose();
	};

	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Attach the handler for the onDidCreateClientInstance event, so we'll
		// update live when a client is created.
		const clientStateEvent = Event.fromObservable(props.client.clientState, disposableStore);
		disposableStore.add(clientStateEvent(state => {
			setState(state);
		}));

		// Attach the handler for the onDidChangeMessageCounter event, so we'll
		// update live when the message counter changes.
		const counterEvent = Event.fromObservable(props.client.messageCounter, disposableStore);
		disposableStore.add(counterEvent(counter => {
			setCounter(counter);
		}));

		// Return the cleanup function that will dispose of the event handlers.
		return () => {
			disposableStore.dispose();
		};
	}, [props.client.clientState, props.client.messageCounter]);

	return <tr className='runtime-client'>
		<td>
			<div className='client-type'>{props.client.getClientType()}</div>
			<div className='client-id'>{props.client.getClientId()}</div>
		</td>
		<td className='message-counter'>
			{counter}
		</td>
		<td colSpan={state === RuntimeClientState.Connected ? 1 : 2}>
			{state}
		</td>
		{state === RuntimeClientState.Connected &&
			<td className='disconnect-button'>
				<a href='#' onClick={disconnect}>
					<span className='codicon codicon-debug-disconnect' title='Disconnect client'></span>
				</a>
			</td>
		}
	</tr>;
};
