/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./consoleRepl';
import * as React from 'react';
import { useEffect } from 'react'; // eslint-disable-line no-duplicate-imports
import { DisposableStore } from 'vs/base/common/lifecycle';
import { useStateRef } from 'vs/base/browser/ui/react/useStateRef';
import { ConsoleReplItem } from 'vs/workbench/contrib/positronConsole/browser/classes/consoleReplItem';
import { ConsoleReplInstance } from 'vs/workbench/contrib/positronConsole/browser/classes/consoleReplInstance';
import { ConsoleReplItemStartupBanner } from 'vs/workbench/contrib/positronConsole/browser/classes/consoleReplItemStartupBanner';
import { generateUuid } from 'vs/base/common/uuid';
import { ConsoleReplItemOutput } from 'vs/workbench/contrib/positronConsole/browser/classes/consoleReplItemOutput';

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
export const ConsoleRepl = ({ hidden, consoleReplInstance }: ConsoleReplProps) => {
	// Hooks.
	const [consoleReplItems, setConsoleReplItems, _refConsoleReplItems] = useStateRef<ConsoleReplItem[]>([]);

	// useEffect for appending items.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// Add the onDidChangeRuntimeState event handler.
		disposableStore.add(consoleReplInstance.replInstance.runtime.onDidChangeRuntimeState(runtimeState => {
			console.log(`ConsoleRepl onDidChangeRuntimeState ${runtimeState}`);
		}));

		// Add the onDidCompleteStartup event handler.
		disposableStore.add(consoleReplInstance.replInstance.runtime.onDidCompleteStartup(languageRuntimeInfo => {
			setConsoleReplItems(consoleReplItems => [...consoleReplItems, new ConsoleReplItemStartupBanner({ key: generateUuid(), timestamp: new Date(), languageRuntimeInfo })]);
		}));

		// Add the onDidReceiveRuntimeMessageOutput event handler.
		disposableStore.add(consoleReplInstance.replInstance.runtime.onDidReceiveRuntimeMessageOutput(languageRuntimeMessageOutput => {
			setConsoleReplItems(consoleReplItems => [...consoleReplItems, new ConsoleReplItemOutput({ key: languageRuntimeMessageOutput.id, timestamp: new Date(), languageRuntimeMessageOutput })]);
		}));

		// Add the onDidReceiveRuntimeMessageInput event handler.
		disposableStore.add(consoleReplInstance.replInstance.runtime.onDidReceiveRuntimeMessageInput(languageRuntimeMessageInput => {
			console.log('+++++++++++++++++++++++ onDidReceiveRuntimeMessageInput');
			console.log(languageRuntimeMessageInput);
		}));

		// Add the onDidReceiveRuntimeMessageError event handler.
		disposableStore.add(consoleReplInstance.replInstance.runtime.onDidReceiveRuntimeMessageError(languageRuntimeMessageError => {
		}));

		// Add the onDidReceiveRuntimeMessagePrompt event handler.
		disposableStore.add(consoleReplInstance.replInstance.runtime.onDidReceiveRuntimeMessagePrompt(languageRuntimeMessagePrompt => {
		}));

		// Add the onDidReceiveRuntimeMessageState event handler.
		disposableStore.add(consoleReplInstance.replInstance.runtime.onDidReceiveRuntimeMessageState(languageRuntimeMessageState => {
		}));

		// Add the onDidReceiveRuntimeMessageEvent event handler.
		disposableStore.add(consoleReplInstance.replInstance.runtime.onDidReceiveRuntimeMessageEvent(languageRuntimeMessageEvent => {
		}));

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, []);

	// Render.
	return (
		<div className='console-repl' hidden={hidden}>
			{consoleReplItems.map(consoleReplItem =>
				consoleReplItem.element
			)}
		</div>
	);
};
