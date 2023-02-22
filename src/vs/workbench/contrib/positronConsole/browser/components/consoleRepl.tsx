/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./consoleRepl';
import * as React from 'react';
import { useEffect, useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { generateUuid } from 'vs/base/common/uuid';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { RuntimeItem } from 'vs/workbench/services/positronConsole/common/classes/runtimeItem';
import { ReplLines } from 'vs/workbench/contrib/positronConsole/browser/components/replLines';
import { RuntimeTrace } from 'vs/workbench/contrib/positronConsole/browser/components/runtimeTrace';
import { RuntimeActivity } from 'vs/workbench/contrib/positronConsole/browser/components/runtimeActivity';
import { ReplLiveInput } from 'vs/workbench/contrib/positronConsole/browser/components/replLiveInput';
import { RuntimeItemTrace } from 'vs/workbench/services/positronConsole/common/classes/runtimeItemTrace';
import { RuntimeItemStartup } from 'vs/workbench/services/positronConsole/common/classes/runtimeItemStartup';
import { RuntimeItemActivity } from 'vs/workbench/services/positronConsole/common/classes/runtimeItemActivity';
import { IPositronConsoleInstance } from 'vs/workbench/services/positronConsole/common/interfaces/positronConsoleInstance';
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
	const [trace, setTrace] = useState(props.positronConsoleInstance.trace);
	const consoleReplLiveInputRef = useRef<HTMLDivElement>(undefined!);
	const [marker, setMarker] = useState(generateUuid());

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

		// Add the onDidChangeTrace event handler.
		disposableStore.add(props.positronConsoleInstance.onDidChangeTrace(trace => {
			setTrace(trace);
		}));

		// Add the onDidChangeRuntimeItems event handler.
		disposableStore.add(props.positronConsoleInstance.onDidChangeRuntimeItems(runtimeItems => {
			setMarker(generateUuid());
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
	}, [marker]);

	/**
	 * Renders a runtime item.
	 * @param runtimeItem The runtime item.
	 * @returns The rendered runtime item.
	 */
	const renderRuntimeItem = (runtimeItem: RuntimeItem) => {
		if (runtimeItem instanceof RuntimeItemActivity) {
			return <RuntimeActivity key={runtimeItem.id} runtimeItemActivity={runtimeItem} />;
		} else if (runtimeItem instanceof RuntimeItemStartup) {
			return <ReplLines key={runtimeItem.id} {...runtimeItem} />;
		} else if (runtimeItem instanceof RuntimeItemTrace) {
			return trace && <RuntimeTrace key={runtimeItem.id} runtimeItemTrace={runtimeItem} />;
		} else {
			return null;
		}
	};

	// Render.
	return (
		<div className='console-repl' hidden={props.hidden}>
			{props.positronConsoleInstance.runtimeItems.map(runtimeItem =>
				renderRuntimeItem(runtimeItem)
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
