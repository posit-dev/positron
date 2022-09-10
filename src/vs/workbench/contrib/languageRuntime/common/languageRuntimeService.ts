/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { INotebookKernel } from 'vs/workbench/contrib/notebook/common/notebookKernelService';
import { Emitter, Event } from 'vs/base/common/event';
import { IDisposable } from 'vs/base/common/lifecycle';

export const ILanguageRuntimeService = createDecorator<ILanguageRuntimeService>('ILanguageRuntimeService');

/**
 * LanguageRuntimeMessage is an interface that defines an event occurring in a
 * language runtime, such as outputting text or plots.
 */
export interface ILanguageRuntimeMessage {
	/** The event ID */
	id: string;

	/** The ID of this event's parent (the event that caused it), if applicable */
	parent_id: string;

	/** The type of event */
	type: string;
}

/** LanguageRuntimeOutput is a LanguageRuntimeMessage representing output (text, plots, etc.) */
export interface ILanguageRuntimeOutput extends ILanguageRuntimeMessage {
	/** A map of data MIME types to the associated data, e.g. `text/plain` => `'hello world'` */
	data: Map<string, string>;
}

export enum RuntimeOnlineState {
	/** The runtime is starting up */
	Starting = 'starting',

	/** The runtime is currently processing an instruction or code fragment */
	Busy = 'busy',

	/** The runtime is idle */
	Idle = 'idle',
}

export interface ILanguageRuntimeState extends ILanguageRuntimeMessage {
	/** The new state */
	state: RuntimeOnlineState;
}

export interface ILanguageRuntimeError extends ILanguageRuntimeMessage {
	/** The error name */
	name: string;

	/** The error message */
	message: string;

	/** The error stack trace */
	traceback: Array<string>;
}

export interface ILanguageRuntime {
	/** The language identifier for this runtime. */
	language: string;

	/** The name of the runtime. */
	name: string;

	/** The version of the runtime. */
	version: string;

	/** An object that emits language runtime events */
	messages: Emitter<ILanguageRuntimeMessage>;

	/** Execute code in the runtime; returns the ID of the code execution. */
	execute(code: string): Thenable<string>;

	/** Interrupt the runtime */
	interrupt(): void;

	/** Restart the runtime */
	restart(): void;

	/** Shut down the runtime */
	shutdown(): void;
}

export interface ILanguageRuntimeService {
	readonly _serviceBrand: undefined;

	readonly onDidStartRuntime: Event<INotebookKernel>;

	/**
	 * @param language The language being registered
	 * @param kernel The NotebookKernel for the language; will be converted to a
	 *   LanguageRuntime
	 */
	registerNotebookRuntime(language: string, kernel: INotebookKernel): void;

	/**
	 * @param runtime The LanguageRuntime to register
	 * @returns A disposable that can be used to unregister the runtime
	 */
	registerRuntime(runtime: ILanguageRuntime): IDisposable;

	/**
	 *
	 * @param language The specific language runtime to retrieve, or `null` to
	 *   retrieve the default
	 */
	getActiveRuntime(language: string | null): INotebookKernel | undefined;

	/**
	 * Selects the active language runtime
	 *
	 * @param language The language to select
	 */
	setActiveRuntime(language: string): void;

	/**
	 * Gets the set of active runtimes
	 */
	getActiveRuntimes(): Array<INotebookKernel>;

	/**
	 * Starts a language runtime
	 *
	 * @param id The id of the runtime to start
	 */
	startRuntime(id: string): void;
}
