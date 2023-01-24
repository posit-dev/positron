/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./consoleRepl';
import * as React from 'react';
import { useEffect, useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { generateUuid } from 'vs/base/common/uuid';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { useStateRef } from 'vs/base/browser/ui/react/useStateRef';
import { IPositronConsoleInstance } from 'vs/workbench/services/positronConsole/common/positronConsole';
import { ConsoleReplItem } from 'vs/workbench/contrib/positronConsole/browser/classes/consoleReplItem';
import { usePositronConsoleContext } from 'vs/workbench/contrib/positronConsole/browser/positronConsoleContext';
import { ConsoleReplItemInput } from 'vs/workbench/contrib/positronConsole/browser/classes/consoleReplItemInput';
import { ConsoleReplItemError } from 'vs/workbench/contrib/positronConsole/browser/classes/consoleReplItemError';
import { ConsoleReplItemTrace } from 'vs/workbench/contrib/positronConsole/browser/classes/consoleReplItemTrace';
import { ConsoleReplItemOutput } from 'vs/workbench/contrib/positronConsole/browser/classes/consoleReplItemOutput';
import { ConsoleReplLiveInput } from 'vs/workbench/contrib/positronConsole/browser/components/consoleReplLiveInput';
import { ConsoleReplItemStartupBanner } from 'vs/workbench/contrib/positronConsole/browser/classes/consoleReplItemStartupBanner';
import { RuntimeCodeExecutionMode, RuntimeErrorBehavior, RuntimeOnlineState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

// ConsoleReplProps interface.
interface ConsoleReplProps {
	hidden: boolean;
	width: number;
	height: number;
	positronConsoleInstance: IPositronConsoleInstance;
}

// ExecutingCodeDescriptor interface.
interface ExecutingCodeDescriptor {
	id: string;
	codeFragment: string;
}

/**
 * ConsoleRepl component.
 * @param props A ConsoleProps that contains the component properties.
 * @returns The rendered component.
 */
export const ConsoleRepl = (props: ConsoleReplProps) => {
	// Hooks.
	const positronConsoleContext = usePositronConsoleContext();
	const [consoleReplItems, setConsoleReplItems] = useState<ConsoleReplItem[]>([]);
	const consoleReplLiveInputRef = useRef<HTMLDivElement>(undefined!);
	const [executingCodeDescriptor, setExecutingCodeDescriptor, refExecutingCodeDescriptor] = useStateRef<ExecutingCodeDescriptor | undefined>(undefined);

	// Adds a ConsoleReplItemTrace to the console.
	const trace = (message: string) => {
		setConsoleReplItems(consoleReplItems => [...consoleReplItems, new ConsoleReplItemTrace({ key: generateUuid(), timestamp: new Date(), message })]);
	};

	// Executes code.
	const executeCode = (codeFragment: string) => {
		// Create the ID.
		const id = `fragment-${generateUuid()}`;

		// Set the executing code descriptor.
		setExecutingCodeDescriptor({
			id,
			codeFragment
		});

		// Execute the code fragment.
		props.positronConsoleInstance.runtime.execute(
			codeFragment,
			id,
			RuntimeCodeExecutionMode.Interactive,
			RuntimeErrorBehavior.Continue);
	};

	// useEffect for appending items.
	useEffect(() => {
		// Create the disposable store for cleanup.
		const disposableStore = new DisposableStore();

		// // Replay history as ConsoleReplItems.
		positronConsoleContext.executionHistoryService.getExecutionEntries(props.positronConsoleInstance.runtime.metadata.id);
		// console.log(`Execution entries for ${props.positronConsoleInstance.runtime.metadata.id} ${props.positronConsoleInstance.runtime.metadata.language}`);
		// console.log(executionEntries);
		// for (const executionEntry of executionEntries) {
		// 	console.log('---');
		// 	console.log(`input ${executionEntry.input}`);
		// 	console.log(`output ${executionEntry.output}`);
		// }

		// Add the onDidChangeRuntimeState event handler.
		disposableStore.add(props.positronConsoleInstance.runtime.onDidChangeRuntimeState(runtimeState => {
			trace(`onDidChangeRuntimeState (${runtimeState})`);
		}));

		// Add the onDidCompleteStartup event handler.
		disposableStore.add(props.positronConsoleInstance.runtime.onDidCompleteStartup(languageRuntimeInfo => {
			trace(`onDidCompleteStartup`);
			setConsoleReplItems(consoleReplItems => [...consoleReplItems, new ConsoleReplItemStartupBanner({ key: generateUuid(), timestamp: new Date(), languageRuntimeInfo })]);
		}));

		// Add the onDidReceiveRuntimeMessageOutput event handler.
		disposableStore.add(props.positronConsoleInstance.runtime.onDidReceiveRuntimeMessageOutput(languageRuntimeMessageOutput => {
			trace(`onDidReceiveRuntimeMessageOutput`);
			setConsoleReplItems(consoleReplItems => [...consoleReplItems, new ConsoleReplItemOutput({ key: languageRuntimeMessageOutput.id, languageRuntimeMessageOutput })]);
		}));

		// Add the onDidReceiveRuntimeMessageInput event handler.
		disposableStore.add(props.positronConsoleInstance.runtime.onDidReceiveRuntimeMessageInput(languageRuntimeMessageInput => {
			trace(`onDidReceiveRuntimeMessageInput`);
			setConsoleReplItems(consoleReplItems => [...consoleReplItems, new ConsoleReplItemInput({ key: languageRuntimeMessageInput.id, languageRuntimeMessageInput })]);
		}));

		// Add the onDidReceiveRuntimeMessageError event handler.
		disposableStore.add(props.positronConsoleInstance.runtime.onDidReceiveRuntimeMessageError(languageRuntimeMessageError => {
			trace(`onDidReceiveRuntimeMessageError`);
			setConsoleReplItems(consoleReplItems => [...consoleReplItems, new ConsoleReplItemError({ key: languageRuntimeMessageError.id, languageRuntimeMessageError })]);
		}));

		// Add the onDidReceiveRuntimeMessagePrompt event handler.
		disposableStore.add(props.positronConsoleInstance.runtime.onDidReceiveRuntimeMessagePrompt(languageRuntimeMessagePrompt => {
			trace(`onDidReceiveRuntimeMessagePrompt`);
		}));

		// Add the onDidReceiveRuntimeMessageState event handler.
		disposableStore.add(props.positronConsoleInstance.runtime.onDidReceiveRuntimeMessageState(languageRuntimeMessageState => {
			trace(`onDidReceiveRuntimeMessageState (${languageRuntimeMessageState.state} ${languageRuntimeMessageState.parent_id})`);

			if (refExecutingCodeDescriptor.current && languageRuntimeMessageState.parent_id === refExecutingCodeDescriptor.current.id) {
				if (languageRuntimeMessageState.state === RuntimeOnlineState.Busy) {
					console.log('Still busy');
				} else if (languageRuntimeMessageState.state === RuntimeOnlineState.Idle) {
					console.log('Done!');
					setExecutingCodeDescriptor(undefined);
				}
			}
		}));

		// Add the onDidReceiveRuntimeMessageEvent event handler.
		disposableStore.add(props.positronConsoleInstance.runtime.onDidReceiveRuntimeMessageEvent(languageRuntimeMessageEvent => {
			trace(`onDidReceiveRuntimeMessageEvent (${languageRuntimeMessageEvent.name})`);
		}));

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, []);

	// Scroll the live input into view when the items change.
	useEffect(() => {
		consoleReplLiveInputRef.current?.scrollIntoView({ behavior: 'auto' });
	}, [consoleReplItems]);

	// Render.
	return (
		<div className='console-repl' hidden={props.hidden}>
			{consoleReplItems.map(consoleReplItem =>
				consoleReplItem.element
			)}
			<ConsoleReplLiveInput ref={consoleReplLiveInputRef} width={props.width} executingCode={!!executingCodeDescriptor} executeCode={executeCode} positronConsoleInstance={props.positronConsoleInstance} />
		</div>
	);
};
