/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { RuntimeItem } from '../classes/runtimeItem.js';
import { Event } from '../../../../../base/common/event.js';
import { IDisposable } from '../../../../../base/common/lifecycle.js';
import { ActivityItemPrompt } from '../classes/activityItemPrompt.js';
import { ICodeEditor } from '../../../../../editor/browser/editorBrowser.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { IExecutionHistoryEntry } from '../../../positronHistory/common/executionHistoryService.js';
import { ILanguageRuntimeSession, IRuntimeSessionMetadata } from '../../../runtimeSession/common/runtimeSessionService.js';
import { ILanguageRuntimeMetadata, RuntimeCodeExecutionMode, RuntimeErrorBehavior } from '../../../languageRuntime/common/languageRuntimeService.js';

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
	Exited = 'Exited',
	Disconnected = 'Disconnected'
}

/**
 * Code attribution sources for code executed in the Console.
 *
 * These are duplicated in the Positron API (`positron.d.ts`) and should be kept
 * in sync.
 */
export const enum CodeAttributionSource {
	Assistant = 'assistant',
	Extension = 'extension',
	Interactive = 'interactive',
	Notebook = 'notebook',
	Paste = 'paste',
	Script = 'script',
}

/**
 * A record containing metadata about the code attribution.
 */
export interface IConsoleCodeAttribution {
	/** The source of the code to be executed */
	source: CodeAttributionSource;

	/** An optional dictionary of addition source-specific metadata*/
	metadata?: Record<string, any>;
}

/**
 * IPositronConsoleService interface.
 */
export interface IPositronConsoleService {
	/**
	 * Needed for service branding in dependency injector.
	 */
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
	 * Gets the active code editor (CodeEditorWidget used to enter code) for the active Positron
	 * console instance.
	 */
	readonly activeCodeEditor: ICodeEditor | undefined;

	/**
	 * The onDidStartPositronConsoleInstance event.
	 */
	readonly onDidStartPositronConsoleInstance: Event<IPositronConsoleInstance>;


	/**
	 * The onDidDeletePositronConsoleInstance event.
	 */
	readonly onDidDeletePositronConsoleInstance: Event<IPositronConsoleInstance>;

	/**
	 * The onDidChangeActivePositronConsoleInstance event.
	 */
	readonly onDidChangeActivePositronConsoleInstance: Event<IPositronConsoleInstance | undefined>;

	/**
	 * Set the active console instance to the one with the given session ID.
	 *
	 * Typically the active console instance should follow the global
	 * foreground session; this method should only be used when the active
	 * console instance needs to be set to a specific session.
	 *
	 * @param sessionId The session ID of the console to activate.
	 */
	setActivePositronConsoleSession(sessionId: string): void;

	/**
	 * Remove the console instance with the given session ID.
	 *
	 * As with setActivePositronConsoleSession, this is only used to remove
	 * provisional instances that aren't tied to a session. Typically, session
	 * deletion should be handled by the runtime session service.
	 *
	 * @param sessionId
	 */
	deletePositronConsoleSession(sessionId: string): void;

	/**
	 * The onDidChangeConsoleWidth event.
	 */
	readonly onDidChangeConsoleWidth: Event<number>;

	/**
	 * Placeholder that gets called to "initialize" the PositronConsoleService.
	 */
	initialize(): void;

	/**
	 * Gets the current console input width, in characters.
	 */
	getConsoleWidth(): number;

	/**
	 * Executes code in a PositronConsoleInstance.
	 *
	 * @param languageId The language ID.
	 * @param code The code.
	 * @param attribution An optional attribution object that describes the source of the code.
	 * @param focus A value which indicates whether to focus Positron console instance.
	 * @param allowIncomplete Whether to bypass runtime code completeness checks. If true, the `code`
	 *   will be executed by the runtime even if it is incomplete or invalid. Defaults to false
	 * @param mode Possible code execution modes for a language runtime
	 * @param errorBehavior Possible error behavior for a language runtime
	 * @param executionId An optional ID to track this execution for observation
	 * @returns The session ID that was assigned to execute the code.
	 */
	executeCode(languageId: string,
		code: string,
		attribution: IConsoleCodeAttribution,
		focus: boolean,
		allowIncomplete?: boolean,
		mode?: RuntimeCodeExecutionMode,
		errorBehavior?: RuntimeErrorBehavior,
		executionId?: string): Promise<string>;

	/**
	 * Fires when code is executed in any Positron console instance.
	 */
	onDidExecuteCode: Event<ILanguageRuntimeCodeExecutedEvent>;
}

/**
 * An enumeration of the session attachment modes for new console instances.
 */
export enum SessionAttachMode {
	/** The console is attaching to a new, starting session */
	Starting = 'starting',

	/** The console is attaching to a restarting session */
	Restarting = 'restarting',

	/** The console is switching to a different session */
	Switching = 'switching',

	/** The console is attaching to a session that is being reconnected */
	Reconnecting = 'reconnecting',

	/** The console is reattaching to a connected session */
	Connected = 'connected',
}

/**
 * Represents a code fragment and its execution options sent to a language runtime.
 */
export interface ILanguageRuntimeCodeExecutedEvent {
	/** The language ID of the code fragment */
	languageId: string;

	/** The code that was executed in the language runtime session */
	code: string;

	/** The attribution object that describes the source of the code */
	attribution: IConsoleCodeAttribution;

	/** The runtime that executed the code. */
	runtimeName: string;

	/** The mode used to execute the code in the language runtime session */
	mode: RuntimeCodeExecutionMode;

	/** The error disposition used to execute the code in the language runtime session */
	errorBehavior: RuntimeErrorBehavior;
}

/**
 * IPositronConsoleInstance interface.
 */
export interface IPositronConsoleInstance {
	/**
	 * Gets the state.
	 */
	readonly state: PositronConsoleState;

	/**
	 * Gets the metadata for the runtime session itself.
	 */
	readonly sessionMetadata: IRuntimeSessionMetadata;

	/**
	 * Gets the metadata of the runtime associated with the session.
	 */
	readonly runtimeMetadata: ILanguageRuntimeMetadata;

	/**
	 * Gets the session ID.
	 */
	readonly sessionId: string;

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
	 * Whether or not we are currently attached to the runtime.
	 */
	readonly runtimeAttached: boolean;

	/**
	 * Is scroll-lock engaged?
	 */
	scrollLocked: boolean;

	/**
	 * Last saved scroll top.
	 */
	lastScrollTop: number;

	/**
	 * Adds disposables that should be cleaned up when this instance is disposed.
	 * @param disposables The disposables to add.
	 */
	addDisposables(disposables: IDisposable): void;

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
	 * The onDidSelectAll event.
	 */
	readonly onDidSelectAll: Event<void>;

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
	readonly onDidExecuteCode: Event<ILanguageRuntimeCodeExecutedEvent>;

	/**
	 * The onDidSelectPlot event.
	 */
	readonly onDidSelectPlot: Event<string>;

	/**
	 * The onDidRequestRestart event.
	 */
	readonly onDidRequestRestart: Event<void>;

	/**
	 * The onDidAttachSession event. Fires both when a session is attached and
	 * when one is detached (in which case the parameter is undefined)
	 */
	readonly onDidAttachSession: Event<ILanguageRuntimeSession | undefined>;

	/**
	 * The onDidChangeWidthInChars event.
	 */
	readonly onDidChangeWidthInChars: Event<number>;

	/**
	 * Focuses the input for the console.
	 */
	focusInput(): void;

	/**
	 * Tells the console its current console input width, in characters. Fires
	 * the onDidChangeWidth event if the width has changed.
	 */
	setWidthInChars(newWidth: number): void;

	/**
	 * Gets the current width of the console input, in characters.
	 */
	getWidthInChars(): number;

	/**
	 * Returns the active code editor for the console, if it exists.
	 */
	codeEditor: ICodeEditor | undefined;

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
	 * Select all text in the console.
	 */
	selectAll(): void;

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
	interrupt(code: string): void;

	/**
	 * Gets the clipboard representation of the console instance.
	 * @param commentPrefix The comment prefix to use.
	 * @returns The clipboard representation of the console instance.
	 */
	getClipboardRepresentation(commentPrefix: string): string[];

	/**
	 * Replays execution history entries, adding their input and output to the
	 * console and preparing the console to reconnect to the runtime.
	 *
	 * @param entry The entry to replay.
	 */
	replayExecutions(entries: IExecutionHistoryEntry<any>[]): void;

	/**
	 * Gets or sets the initial working directory displayed in the console.
	 *
	 * This does not actually change the working directory of the runtime session.
	 */
	initialWorkingDirectory: string;

	/**
	 * Enqueues code to be executed.
	 * @param code The code to enqueue.
	 * @param attribution An optional attribution object that describes the source of the code.
	 * @param allowIncomplete Whether to bypass runtime code completeness checks. If true, the `code`
	 *   will be executed by the runtime even if it is incomplete or invalid. Defaults to false
	 * @param mode Possible code execution modes for a language runtime.
	 * @param errorBehavior Possible error behavior for a language runtime
	 * @param executionId An optional ID to track this execution for observation
	 */
	enqueueCode(code: string,
		attribution: IConsoleCodeAttribution,
		allowIncomplete?: boolean,
		mode?: RuntimeCodeExecutionMode,
		errorBehavior?: RuntimeErrorBehavior,
		executionId?: string): Promise<void>;

	/**
	 * Executes code.
	 * @param code The code to execute.
	 * @param attribution An optional attribution object that describes the source of the code.
	 * @param mode Possible code execution modes for a language runtime.
	 * @param errorBehavior Possible error behavior for a language runtime
	 * @param executionId An optional ID to track this execution for observation
	 */
	executeCode(code: string,
		attribution: IConsoleCodeAttribution,
		mode?: RuntimeCodeExecutionMode,
		errorBehavior?: RuntimeErrorBehavior,
		executionId?: string): void;

	/**
	 * Replies to a prompt.
	 * @param activityItemPrompt The prompt activity item.
	 * @param value The value.
	 */
	replyToPrompt(activityItemPrompt: ActivityItemPrompt, value: string): void;

	/**
	 * Interrupts prompt.
	 * @param activityItemPrompt The prompt activity item.
	 */
	interruptPrompt(activityItemPrompt: ActivityItemPrompt): void;

	/**
	 * Attaches a runtime session to the console.
	 *
	 * @param session The session to attach.
	 * @param mode The session attach mode.
	 */
	attachRuntimeSession(session: ILanguageRuntimeSession | undefined, mode: SessionAttachMode): void;

	/**
	 * Gets the currently attached runtime, or undefined if none.
	 */
	attachedRuntimeSession: ILanguageRuntimeSession | undefined;
}
