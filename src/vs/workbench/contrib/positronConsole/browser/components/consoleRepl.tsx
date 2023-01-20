/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./consoleRepl';
import * as React from 'react';
import { useEffect } from 'react'; // eslint-disable-line no-duplicate-imports
import { generateUuid } from 'vs/base/common/uuid';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { useStateRef } from 'vs/base/browser/ui/react/useStateRef';
import { ConsoleReplItem } from 'vs/workbench/contrib/positronConsole/browser/classes/consoleReplItem';
import { ConsoleReplInstance } from 'vs/workbench/contrib/positronConsole/browser/classes/consoleReplInstance';
import { ConsoleReplItemInput } from 'vs/workbench/contrib/positronConsole/browser/classes/consoleReplItemInput';
import { ConsoleReplItemError } from 'vs/workbench/contrib/positronConsole/browser/classes/consoleReplItemError';
import { ConsoleReplItemOutput } from 'vs/workbench/contrib/positronConsole/browser/classes/consoleReplItemOutput';
import { ConsoleReplLiveInput } from 'vs/workbench/contrib/positronConsole/browser/components/consoleReplLiveInput';
import { ConsoleReplItemStartupBanner } from 'vs/workbench/contrib/positronConsole/browser/classes/consoleReplItemStartupBanner';

// ConsoleReplProps interface.
interface ConsoleReplProps {
	hidden: boolean;
	consoleReplInstance: ConsoleReplInstance;
}

/**
 * ConsoleRepl component.
 * @param props A ConsoleProps that contains the component properties.
 * @returns The rendered component.
 */
export const ConsoleRepl = (props: ConsoleReplProps) => {
	// Hooks.
	const [consoleReplItems, setConsoleReplItems, _refConsoleReplItems] = useStateRef<ConsoleReplItem[]>([]);

	// useEffect for appending items.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onDidChangeRuntimeState event handler.
		disposableStore.add(props.consoleReplInstance.positronConsoleInstance.runtime.onDidChangeRuntimeState(runtimeState => {
			console.log(`ConsoleRepl onDidChangeRuntimeState ${runtimeState}`);
		}));

		// Get history.
		// Replay history as ConsoleReplItems.

		// Add the onDidCompleteStartup event handler.
		disposableStore.add(props.consoleReplInstance.positronConsoleInstance.runtime.onDidCompleteStartup(languageRuntimeInfo => {
			setConsoleReplItems(consoleReplItems => [...consoleReplItems, new ConsoleReplItemStartupBanner({ key: generateUuid(), timestamp: new Date(), languageRuntimeInfo })]);
		}));

		// Add the onDidReceiveRuntimeMessageOutput event handler.
		disposableStore.add(props.consoleReplInstance.positronConsoleInstance.runtime.onDidReceiveRuntimeMessageOutput(languageRuntimeMessageOutput => {
			setConsoleReplItems(consoleReplItems => [...consoleReplItems, new ConsoleReplItemOutput({ key: languageRuntimeMessageOutput.id, timestamp: new Date(), languageRuntimeMessageOutput })]);
		}));

		// Add the onDidReceiveRuntimeMessageInput event handler.
		disposableStore.add(props.consoleReplInstance.positronConsoleInstance.runtime.onDidReceiveRuntimeMessageInput(languageRuntimeMessageInput => {
			setConsoleReplItems(consoleReplItems => [...consoleReplItems, new ConsoleReplItemInput({ key: languageRuntimeMessageInput.id, timestamp: new Date(), languageRuntimeMessageInput })]);
		}));

		// Add the onDidReceiveRuntimeMessageError event handler.
		disposableStore.add(props.consoleReplInstance.positronConsoleInstance.runtime.onDidReceiveRuntimeMessageError(languageRuntimeMessageError => {
			setConsoleReplItems(consoleReplItems => [...consoleReplItems, new ConsoleReplItemError({ key: languageRuntimeMessageError.id, timestamp: new Date(), languageRuntimeMessageError })]);
		}));

		// Add the onDidReceiveRuntimeMessagePrompt event handler.
		disposableStore.add(props.consoleReplInstance.positronConsoleInstance.runtime.onDidReceiveRuntimeMessagePrompt(languageRuntimeMessagePrompt => {
			console.log('onDidReceiveRuntimeMessagePrompt');
			console.log(languageRuntimeMessagePrompt);
		}));

		// Add the onDidReceiveRuntimeMessageState event handler.
		disposableStore.add(props.consoleReplInstance.positronConsoleInstance.runtime.onDidReceiveRuntimeMessageState(languageRuntimeMessageState => {
			console.log('onDidReceiveRuntimeMessageState');
			console.log(languageRuntimeMessageState);
		}));

		// Add the onDidReceiveRuntimeMessageEvent event handler.
		disposableStore.add(props.consoleReplInstance.positronConsoleInstance.runtime.onDidReceiveRuntimeMessageEvent(languageRuntimeMessageEvent => {
			console.log('onDidReceiveRuntimeMessageEvent');
			console.log(languageRuntimeMessageEvent);
		}));

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, []);

	const keyFoo = generateUuid();

	// Render.
	return (
		<div className='console-repl' hidden={props.hidden}>
			{consoleReplItems.map(consoleReplItem =>
				consoleReplItem.element
			)}
			<ConsoleReplLiveInput key={keyFoo} {...props} />
		</div>
	);
};
