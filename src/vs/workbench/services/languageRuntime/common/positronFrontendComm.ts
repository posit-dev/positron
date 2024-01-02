/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

//
// AUTO-GENERATED from frontend.json; do not edit.
//

import { Event } from 'vs/base/common/event';
import { PositronBaseComm } from 'vs/workbench/services/languageRuntime/common/positronBaseComm';
import { IRuntimeClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeClientInstance';

/**
 * Items in Params
 */
export interface Params {
	[k: string]: unknown;
}

/**
 * The method result
 */
export interface CallMethodResult {
	[k: string]: unknown;
}

/**
 * Event: Change in backend's busy/idle status
 */
export interface BusyEvent {
	/**
	 * Whether the backend is busy
	 */
	busy: boolean;

}

/**
 * Event: Clear the console
 */
export interface ClearConsoleEvent {
}

/**
 * Event: Open an editor
 */
export interface OpenEditorEvent {
	/**
	 * The path of the file to open
	 */
	file: string;

	/**
	 * The line number to jump to
	 */
	line: number;

	/**
	 * The column number to jump to
	 */
	column: number;

}

/**
 * Event: Show a message
 */
export interface ShowMessageEvent {
	/**
	 * The message to show to the user.
	 */
	message: string;

}

/**
 * Event: New state of the primary and secondary prompts
 */
export interface PromptStateEvent {
	/**
	 * Prompt for primary input.
	 */
	input_prompt: string;

	/**
	 * Prompt for incomplete input.
	 */
	continuation_prompt: string;

}

/**
 * Event: Change the displayed working directory
 */
export interface WorkingDirectoryEvent {
	/**
	 * The new working directory
	 */
	directory: string;

}

export enum FrontendEvent {
	Busy = 'busy',
	ClearConsole = 'clear_console',
	OpenEditor = 'open_editor',
	ShowMessage = 'show_message',
	PromptState = 'prompt_state',
	WorkingDirectory = 'working_directory'
}

export class PositronFrontendComm extends PositronBaseComm {
	constructor(instance: IRuntimeClientInstance<any, any>) {
		super(instance);
		this.onDidBusy = super.createEventEmitter('busy', ['busy']);
		this.onDidClearConsole = super.createEventEmitter('clear_console', []);
		this.onDidOpenEditor = super.createEventEmitter('open_editor', ['file', 'line', 'column']);
		this.onDidShowMessage = super.createEventEmitter('show_message', ['message']);
		this.onDidPromptState = super.createEventEmitter('prompt_state', ['input_prompt', 'continuation_prompt']);
		this.onDidWorkingDirectory = super.createEventEmitter('working_directory', ['directory']);
	}

	/**
	 * Run a method in the interpreter and return the result to the frontend
	 *
	 * Unlike other RPC methods, `call_method` calls into methods implemented
	 * in the interpreter and returns the result back to the frontend using
	 * an implementation-defined serialization scheme.
	 *
	 * @param method The method to call inside the interpreter
	 * @param params The parameters for `method`
	 *
	 * @returns The method result
	 */
	callMethod(method: string, params: Array<Params>): Promise<CallMethodResult> {
		return super.performRpc('call_method', ['method', 'params'], [method, params]);
	}


	/**
	 * Change in backend's busy/idle status
	 *
	 * This represents the busy state of the underlying computation engine,
	 * not the busy state of the kernel. The kernel is busy when it is
	 * processing a request, but the runtime is busy only when a computation
	 * is running.
	 */
	onDidBusy: Event<BusyEvent>;
	/**
	 * Clear the console
	 *
	 * Use this to clear the console.
	 */
	onDidClearConsole: Event<ClearConsoleEvent>;
	/**
	 * Open an editor
	 *
	 * This event is used to open an editor with a given file and selection.
	 */
	onDidOpenEditor: Event<OpenEditorEvent>;
	/**
	 * Show a message
	 *
	 * Use this for messages that require immediate attention from the user
	 */
	onDidShowMessage: Event<ShowMessageEvent>;
	/**
	 * New state of the primary and secondary prompts
	 *
	 * Languages like R allow users to change the way their prompts look.
	 * This event signals a change in the prompt configuration.
	 */
	onDidPromptState: Event<PromptStateEvent>;
	/**
	 * Change the displayed working directory
	 *
	 * This event signals a change in the working direcotry of the
	 * interpreter
	 */
	onDidWorkingDirectory: Event<WorkingDirectoryEvent>;
}

