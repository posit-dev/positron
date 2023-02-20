/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./consoleRepl';
import * as React from 'react';
import { useEffect, useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { generateUuid } from 'vs/base/common/uuid';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { RuntimeItem } from 'vs/workbench/contrib/positronConsole/browser/classes/runtimeItem';
import { ReplLines } from 'vs/workbench/contrib/positronConsole/browser/components/replLines';
import { RuntimeTrace } from 'vs/workbench/contrib/positronConsole/browser/components/runtimeTrace';
import { RuntimeItemTrace } from 'vs/workbench/contrib/positronConsole/browser/classes/runtimeItemTrace';
import { ReplActivity } from 'vs/workbench/contrib/positronConsole/browser/components/replActivity';
import { ReplLiveInput } from 'vs/workbench/contrib/positronConsole/browser/components/replLiveInput';
import { RuntimeItemStartup } from 'vs/workbench/contrib/positronConsole/browser/classes/runtimeItemStartup';
import { RuntimeItemActivity } from 'vs/workbench/contrib/positronConsole/browser/classes/runtimeItemActivity';
import { usePositronConsoleContext } from 'vs/workbench/contrib/positronConsole/browser/positronConsoleContext';
import { IPositronConsoleInstance } from 'vs/workbench/contrib/positronConsole/browser/interfaces/positronConsoleInstance';
import { RuntimeCodeExecutionMode, RuntimeErrorBehavior } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';

// ConsoleReplProps interface.
interface ConsoleReplProps {
	hidden: boolean;
	width: number;
	height: number;
	positronConsoleInstance: IPositronConsoleInstance;
}

/**
 * ConsoleRepl component.
 * @param props A ConsoleProps that contains the component properties.
 * @returns The rendered component.
 */
export const ConsoleRepl = (props: ConsoleReplProps) => {
	// Hooks.
	const positronConsoleContext = usePositronConsoleContext();
	const [trace, setTrace] = useState(props.positronConsoleInstance.trace);
	const consoleReplLiveInputRef = useRef<HTMLDivElement>(undefined!);

	// Executes code.
	const executeCode = (codeFragment: string) => {
		// Create the ID.
		const id = `fragment-${generateUuid()}`;

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

		// Add the onDidClearConsole event handler.
		disposableStore.add(props.positronConsoleInstance.onDidChangeTrace(trace => {
			setTrace(trace);
		}));

		// Add the onDidClearConsole event handler.
		disposableStore.add(props.positronConsoleInstance.onDidClearConsole(() => {
		}));

		// Add the onDidExecuteCode event handler.
		disposableStore.add(props.positronConsoleInstance.onDidExecuteCode(codeFragment => {
			// Execute the code fragment.
			executeCode(codeFragment);
		}));

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, []);

	// Experimental.
	useEffect(() => {
		consoleReplLiveInputRef.current?.scrollIntoView({ behavior: 'auto' });
	}, [positronConsoleContext]);

	/**
	 * Renders a repl item.
	 * @param runtimeItem The repl item.
	 * @returns The rendered repl item.
	 */
	const renderReplItem = (runtimeItem: RuntimeItem) => {
		if (runtimeItem instanceof RuntimeItemActivity) {
			return <ReplActivity key={runtimeItem.id} replItemActivity={runtimeItem} />;
		} else if (runtimeItem instanceof RuntimeItemStartup) {
			return <ReplLines {...runtimeItem} />;
		} else if (runtimeItem instanceof RuntimeItemTrace) {
			return trace && <RuntimeTrace key={runtimeItem.id} runtimeItemTrace={runtimeItem} />;
		} else {
			return null;
		}
	};

	// Render.
	return (
		<div className='console-repl' hidden={props.hidden}>
			{props.positronConsoleInstance.runtimeItems.map(replItem =>
				renderReplItem(replItem)
			)}
			<ReplLiveInput
				ref={consoleReplLiveInputRef}
				hidden={props.hidden}
				width={props.width}
				executeCode={executeCode}
				positronConsoleInstance={props.positronConsoleInstance} />
		</div>
	);
};
