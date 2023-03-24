/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./consoleInstance';
import * as React from 'react';
import { useEffect, useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { generateUuid } from 'vs/base/common/uuid';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { IFocusReceiver } from 'vs/base/browser/positronReactRenderer';
import { BusyInput } from 'vs/workbench/contrib/positronConsole/browser/components/busyInput';
import { LiveInput } from 'vs/workbench/contrib/positronConsole/browser/components/liveInput';
import { RuntimeItem } from 'vs/workbench/services/positronConsole/common/classes/runtimeItem';
import { RuntimeTrace } from 'vs/workbench/contrib/positronConsole/browser/components/runtimeTrace';
import { RuntimeExited } from 'vs/workbench/contrib/positronConsole/browser/components/runtimeExited';
import { RuntimeStartup } from 'vs/workbench/contrib/positronConsole/browser/components/runtimeStartup';
import { RuntimeStarted } from 'vs/workbench/contrib/positronConsole/browser/components/runtimeStarted';
import { RuntimeOffline } from 'vs/workbench/contrib/positronConsole/browser/components/runtimeOffline';
import { RuntimeItemTrace } from 'vs/workbench/services/positronConsole/common/classes/runtimeItemTrace';
import { RuntimeStarting } from 'vs/workbench/contrib/positronConsole/browser/components/runtimeStarting';
import { RuntimeActivity } from 'vs/workbench/contrib/positronConsole/browser/components/runtimeActivity';
import { RuntimeItemExited } from 'vs/workbench/services/positronConsole/common/classes/runtimeItemExited';
import { RuntimeItemStartup } from 'vs/workbench/services/positronConsole/common/classes/runtimeItemStartup';
import { RuntimeItemStarted } from 'vs/workbench/services/positronConsole/common/classes/runtimeItemStarted';
import { RuntimeItemOffline } from 'vs/workbench/services/positronConsole/common/classes/runtimeItemOffline';
import { RuntimeItemStarting } from 'vs/workbench/services/positronConsole/common/classes/runtimeItemStarting';
import { RuntimeItemActivity } from 'vs/workbench/services/positronConsole/common/classes/runtimeItemActivity';
import { RuntimeReconnected } from 'vs/workbench/contrib/positronConsole/browser/components/runtimeReconnected';
import { RuntimeItemReconnected } from 'vs/workbench/services/positronConsole/common/classes/runtimeItemReconnected';
import { RuntimeCodeExecutionMode, RuntimeErrorBehavior } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IPositronConsoleInstance, PositronConsoleState } from 'vs/workbench/services/positronConsole/common/interfaces/positronConsoleService';
import { RuntimeItemStartupFailure } from 'vs/workbench/services/positronConsole/common/classes/runtimeItemStartupFailure';
import { RuntimeStartupFailure } from 'vs/workbench/contrib/positronConsole/browser/components/runtimeStartupFailure';

// ConsoleInstanceProps interface.
interface ConsoleInstanceProps {
	readonly hidden: boolean;
	readonly width: number;
	readonly height: number;
	readonly positronConsoleInstance: IPositronConsoleInstance;
	readonly focusReceiver: IFocusReceiver;
}

/**
 * ConsoleInstance component.
 * @param props A ConsoleInstanceProps that contains the component properties.
 * @returns The rendered component.
 */
export const ConsoleInstance = (props: ConsoleInstanceProps) => {
	// Hooks.
	const [trace, setTrace] = useState(props.positronConsoleInstance.trace);
	const inputRef = useRef<HTMLDivElement>(undefined!);
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

		// Add the onDidChangeState event handler.
		disposableStore.add(props.positronConsoleInstance.onDidChangeState(state => {
		}));

		// Add the onDidChangeTrace event handler.
		disposableStore.add(props.positronConsoleInstance.onDidChangeTrace(trace => {
			setTrace(trace);
		}));

		// Add the onDidChangeRuntimeItems event handler.
		disposableStore.add(props.positronConsoleInstance.onDidChangeRuntimeItems(runtimeItems => {
			setMarker(generateUuid());
		}));

		// Add the onDidExecuteCode event handler.
		disposableStore.add(props.positronConsoleInstance.onDidExecuteCode(codeFragment => {
			// Execute the code fragment.
			executeCode(codeFragment);
		}));

		// Add the onFocused event handler.
		disposableStore.add(props.focusReceiver.onFocused(() => {
			if (!props.hidden) {
				inputRef.current?.scrollIntoView({ behavior: 'auto' });
			}
		}));

		// Return the cleanup function that will dispose of the event handlers.
		return () => disposableStore.dispose();
	}, []);

	// Experimental.
	useEffect(() => {
		inputRef.current?.scrollIntoView({ behavior: 'auto' });
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
			return <RuntimeStartup key={runtimeItem.id} runtimeItemStartup={runtimeItem} />;
		} else if (runtimeItem instanceof RuntimeItemReconnected) {
			return <RuntimeReconnected key={runtimeItem.id} runtimeItemReconnected={runtimeItem} />;
		} else if (runtimeItem instanceof RuntimeItemStarting) {
			return <RuntimeStarting key={runtimeItem.id} runtimeItemStarting={runtimeItem} />;
		} else if (runtimeItem instanceof RuntimeItemStarted) {
			return <RuntimeStarted key={runtimeItem.id} runtimeItemStarted={runtimeItem} />;
		} else if (runtimeItem instanceof RuntimeItemOffline) {
			return <RuntimeOffline key={runtimeItem.id} runtimeItemOffline={runtimeItem} />;
		} else if (runtimeItem instanceof RuntimeItemExited) {
			return <RuntimeExited key={runtimeItem.id} runtimeItemExited={runtimeItem} />;
		} else if (runtimeItem instanceof RuntimeItemStartupFailure) {
			return <RuntimeStartupFailure key={runtimeItem.id} runtimeItemStartupFailure={runtimeItem} />;
		} else if (runtimeItem instanceof RuntimeItemTrace) {
			return trace && <RuntimeTrace key={runtimeItem.id} runtimeItemTrace={runtimeItem} />;
		} else {
			return null;
		}
	};

	/**
	 * Renders the input.
	 * @returns The input that was rendered.
	 */
	const renderInput = () => {
		// Based on state, render the input.
		switch (props.positronConsoleInstance.state) {
			// Ready.
			case PositronConsoleState.Ready:
				return <LiveInput
					ref={inputRef}
					width={props.width}
					hidden={props.hidden}
					executeCode={executeCode}
					positronConsoleInstance={props.positronConsoleInstance}
					focusReceiver={props.focusReceiver} />;

			// Busy.
			case PositronConsoleState.Busy:
				return <BusyInput
					ref={inputRef}
					width={props.width}
					hidden={props.hidden}
					positronConsoleInstance={props.positronConsoleInstance}
					focusReceiver={props.focusReceiver} />;

			// Render nothing.
			default:
				return null;
		}
	};

	// Render.
	return (
		<div className='console-instance' hidden={props.hidden}>
			{props.positronConsoleInstance.runtimeItems.map(runtimeItem =>
				renderRuntimeItem(runtimeItem)
			)}
			{renderInput()}
		</div>
	);
};
