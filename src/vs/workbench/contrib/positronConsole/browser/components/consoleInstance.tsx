/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./consoleInstance';
import * as React from 'react';
import { useEffect, useRef, useState } from 'react'; // eslint-disable-line no-duplicate-imports
import { generateUuid } from 'vs/base/common/uuid';
import { PixelRatio } from 'vs/base/browser/browser';
import { BareFontInfo } from 'vs/editor/common/config/fontInfo';
import { applyFontInfo } from 'vs/editor/browser/config/domFontInfo';
import { IFocusReceiver } from 'vs/base/browser/positronReactRenderer';
import { IEditorOptions } from 'vs/editor/common/config/editorOptions';
import { DisposableStore, IDisposable } from 'vs/base/common/lifecycle';
import { FontMeasurements } from 'vs/editor/browser/config/fontMeasurements';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ConsoleInput } from 'vs/workbench/contrib/positronConsole/browser/components/consoleInput';
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
import { usePositronConsoleContext } from 'vs/workbench/contrib/positronConsole/browser/positronConsoleContext';
import { RuntimeReconnected } from 'vs/workbench/contrib/positronConsole/browser/components/runtimeReconnected';
import { RuntimeItemReconnected } from 'vs/workbench/services/positronConsole/common/classes/runtimeItemReconnected';
import { RuntimeStartupFailure } from 'vs/workbench/contrib/positronConsole/browser/components/runtimeStartupFailure';
import { RuntimeItemStartupFailure } from 'vs/workbench/services/positronConsole/common/classes/runtimeItemStartupFailure';
import { RuntimeCodeExecutionMode, RuntimeErrorBehavior } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IPositronConsoleInstance } from 'vs/workbench/services/positronConsole/common/interfaces/positronConsoleService';

// ConsoleInstanceProps interface.
interface ConsoleInstanceProps {
	readonly hidden: boolean;
	readonly width: number;
	readonly height: number;
	readonly positronConsoleInstance: IPositronConsoleInstance;
	readonly focusReceiver: IFocusReceiver;
}

/**
 * Editor font tracker.
 * @param configurationService The configuratio service.
 * @param element The element to apply the editor font info to.
 * @returns An IDisposable that should be disposed when the editor font tracker is no longer needed.
 */
const editorFontTracker = (
	configurationService: IConfigurationService,
	element: HTMLDivElement
): IDisposable => {
	// Get the editor options and read the font info.
	const editorOptions = configurationService.getValue<IEditorOptions>('editor');
	const fontInfo = FontMeasurements.readFontInfo(
		BareFontInfo.createFromRawSettings(editorOptions, PixelRatio.value)
	);

	// Apply the font info to the element.
	applyFontInfo(element, fontInfo);

	// Watch for configuratio changes.
	return configurationService.onDidChangeConfiguration(
		configurationChangeEvent => {
			// When something in the editor changes, determine whether it's font-related
			// and, if it is, apply the new font info to the container.
			if (configurationChangeEvent.affectsConfiguration('editor')) {
				if (configurationChangeEvent.affectedKeys.has('editor.fontFamily') ||
					configurationChangeEvent.affectedKeys.has('editor.fontWeight') ||
					configurationChangeEvent.affectedKeys.has('editor.fontSize') ||
					configurationChangeEvent.affectedKeys.has('editor.fontLigatures') ||
					configurationChangeEvent.affectedKeys.has('editor.fontVariations') ||
					configurationChangeEvent.affectedKeys.has('editor.lineHeight') ||
					configurationChangeEvent.affectedKeys.has('editor.letterSpacing')
				) {
					// Get the editor options and read the font info.
					const fontInfo = FontMeasurements.readFontInfo(
						BareFontInfo.createFromRawSettings(
							configurationService.
								getValue<IEditorOptions>('editor'),
							PixelRatio.value
						)
					);

					// Apply the font info to the Positron environment container.
					applyFontInfo(element, fontInfo);
				}
			}
		}
	);
};

/**
 * ConsoleInstance component.
 * @param props A ConsoleInstanceProps that contains the component properties.
 * @returns The rendered component.
 */
export const ConsoleInstance = (props: ConsoleInstanceProps) => {
	// Context hooks.
	const positronConsoleContext = usePositronConsoleContext();

	// Reference hooks.
	const instanceRef = useRef<HTMLDivElement>(undefined!);
	const inputRef = useRef<HTMLDivElement>(undefined!);

	// State hooks.
	const [trace, setTrace] = useState(props.positronConsoleInstance.trace);
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

		// Add the editor font tracker.
		disposableStore.add(editorFontTracker(
			positronConsoleContext.configurationService,
			instanceRef.current
		));

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

	// Render.
	return (
		<div ref={instanceRef} className='console-instance' hidden={props.hidden}>
			{props.positronConsoleInstance.runtimeItems.map(runtimeItem =>
				renderRuntimeItem(runtimeItem)
			)}
			<ConsoleInput
				ref={inputRef}
				width={props.width - 28}
				hidden={props.hidden}
				focusReceiver={props.focusReceiver}
				executeCode={executeCode}
				positronConsoleInstance={props.positronConsoleInstance}
			/>
		</div>
	);
};
