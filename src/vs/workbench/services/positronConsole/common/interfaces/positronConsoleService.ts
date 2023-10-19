/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { RuntimeItem } from 'vs/workbench/services/positronConsole/common/classes/runtimeItem';
import { ILanguageRuntime } from 'vs/workbench/services/languageRuntime/common/languageRuntimeService';
import { IEditor } from 'vs/editor/common/editorCommon';

// Create the decorator for the Positron console service (used in dependency injection).
export const IPositronConsoleService = createDecorator<IPositronConsoleService>('positronConsoleService');

/**
 * The Positron console view ID.
 */
export const POSITRON_CONSOLE_VIEW_ID = 'workbench.panel.positronConsole';

/**
 * PositronConsoleState enumeration.
 */
export const enum PositronConsoleState {
	Uninitialized = 'Uninitialized',
	Starting = 'Starting',
	Busy = 'Busy',
	Ready = 'Ready',
	Offline = 'Offline',
	Exiting = 'Exiting',
	Exited = 'Exited'
}

/**
 * IPositronConsoleService interface.
 */
export interface IPositronConsoleService {
	// Needed for service branding in dependency injector.
	readonly _serviceBrand: undefined;

	/**
	 * Gets the Positron console instances.
	 */
	readonly positronConsoleInstances: IPositronConsoleInstance[];

	/**
	 * Gets the active Positron console instance.
	 */
	readonly activePositronConsoleInstance?: IPositronConsoleInstance;

	/**
	 * Gets the text editor (mini editor used to enter code at the REPL) for the
	 * active Positron console instance.
	 */
	readonly activeInputTextEditor: IEditor | undefined;

	/**
	 * The onDidStartPositronConsoleInstance event.
	 */
	readonly onDidStartPositronConsoleInstance: Event<IPositronConsoleInstance>;

	/**
	 * The onDidChangeActivePositronConsoleInstance event.
	 */
	readonly onDidChangeActivePositronConsoleInstance: Event<IPositronConsoleInstance | undefined>;

	/**
	 * Placeholder that gets called to "initialize" the PositronConsoleService.
	 */
	initialize(): void;

	/**
	 * Executes code in a PositronConsoleInstance.
	 * @param languageId The language ID.
	 * @param code The code.
	 * @param activate A value which indicates whether to activate the Positron console instance.
	 * @returns A value which indicates whether the code could be executed.
	 */
	executeCode(languageId: string, code: string, activate: boolean): Promise<boolean>;
}

/**
 * IPositronConsoleInstance interface.
 */
export interface IPositronConsoleInstance {
	/**
	 * Gets the runtime for the Positron console instance.
	 */
	readonly runtime: ILanguageRuntime;

	/**
	 * Gets the state.
	 */
	readonly state: PositronConsoleState;

	/**
	 * Gets a value which indicates whether trace is enabled.
	 */
	readonly trace: boolean;

	/**
	 * Gets a value which indicates whether word wrap is enabled.
	 */
	readonly wordWrap: boolean;

	/**
	 * Gets the runtime items.
	 */
	readonly runtimeItems: RuntimeItem[];

	/**
	 * Gets a value which indicates whether a prompt is active.
	 */
	readonly promptActive: boolean;

	/**
	 * The onFocusInput event.
	 */
	readonly onFocusInput: Event<void>;

	/**
	 * The onDidChangeState event.
	 */
	readonly onDidChangeState: Event<PositronConsoleState>;

	/**
	 * The onDidChangeWordWrap event.
	 */
	readonly onDidChangeWordWrap: Event<boolean>;

	/**
	 * The onDidChangeTrace event.
	 */
	readonly onDidChangeTrace: Event<boolean>;

	/**
	 * The onDidChangeRuntimeItems event.
	 */
	readonly onDidChangeRuntimeItems: Event<void>;

	/**
	 * The onDidPasteText event.
	 */
	readonly onDidPasteText: Event<string>;

	/**
	 * The onDidClearConsole event.
	 */
	readonly onDidClearConsole: Event<void>;

	/**
	 * The onDidClearInputHistory event.
	 */
	readonly onDidClearInputHistory: Event<void>;

	/**
	 * The onDidSetPendingCode event.
	 */
	readonly onDidSetPendingCode: Event<string | undefined>;

	/**
	 * The onDidExecuteCode event.
	 */
	readonly onDidExecuteCode: Event<void>;

	/**
	 * The onDidSelectPlot event.
	 */
	readonly onDidSelectPlot: Event<string>;

	/**
	 * The onDidRequestRestart event.
	 */
	readonly onDidRequestRestart: Event<void>;

	/**
	 * The onDidAttachRuntime event. Fires both when a runtime is attached and
	 * when one is detached (in which case the parameter is undefined)
	 */
	readonly onDidAttachRuntime: Event<ILanguageRuntime | undefined>;

	/**
	 * Focuses the input for the console.
	 */
	focusInput(): void;

	/**
	 * Returns the active text editor widget for the console, if it exists.
	 */
	inputTextEditor: IEditor | undefined;

	/**
	 * Toggles trace.
	 */
	toggleTrace(): void;

	/**
	 * Toggles word wrap.
	 */
	toggleWordWrap(): void;

	/**
	 * Pastes text into the console.
	 */
	pasteText(text: string): void;

	/**
	 * Clears the console.
	 */
	clearConsole(): void;

	/**
	 * Clears the input history.
	 */
	clearInputHistory(): void;

	/**
	 * Interrupts the console.
	 */
	interrupt(): void;

	/**
	 * Enqueues code to be executed.
	 * @param code The code to enqueue.
	 */
	enqueueCode(code: string): Promise<void>;

	/**
	 * Executes code.
	 * @param code The code to execute.
	 */
	executeCode(code: string): void;

	/**
	 * Replies to a prompt.
	 * @param id The prompt identifier.
	 * @param value The value.
	 */
	replyToPrompt(id: string, value: string): void;

	/**
	 * Interrupts prompt.
	 * @param id The prompt identifier.
	 */
	interruptPrompt(id: string): void;

	/**
	 * Sets the currently attached runtime, or undefined if none.
	 */
	attachedRuntime: ILanguageRuntime | undefined;
}
