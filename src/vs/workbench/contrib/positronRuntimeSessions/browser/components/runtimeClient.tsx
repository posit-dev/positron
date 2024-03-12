/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./runtimeClient';
import * as React from 'react';
import { useEffect, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { IRuntimeClientInstance, RuntimeClientState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeClientInstance';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { Event } from 'vs/base/common/event';

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
	}, []);

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
