/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

//
// AUTO-GENERATED from ui.json; do not edit.
//

import { Event } from '../../../../base/common/event.js';
import { PositronBaseComm, PositronCommOptions } from './positronBaseComm.js';
import { IRuntimeClientInstance } from './languageRuntimeClientInstance.js';

/**
 * Items in Params
 */
export interface Param {
	[k: string]: unknown;
}

/**
 * The method result
 */
export interface CallMethodResult {
	[k: string]: unknown;
}

/**
 * Parameters for the CallMethod method.
 */
export interface CallMethodParams {
	/**
	 * The method to call inside the interpreter
	 */
	method: string;

	/**
	 * The parameters for `method`
	 */
	params: Array<Param>;
}

/**
 * Editor metadata
 */
export interface EditorContext {
	/**
	 * Document metadata
	 */
	document: TextDocument;

	/**
	 * Document contents
	 */
	contents: Array<string>;

	/**
	 * The primary selection, i.e. selections[0]
	 */
	selection: Selection;

	/**
	 * The selections in this text editor.
	 */
	selections: Array<Selection>;

}

/**
 * Document metadata
 */
export interface TextDocument {
	/**
	 * URI of the resource viewed in the editor
	 */
	path: string;

	/**
	 * End of line sequence
	 */
	eol: string;

	/**
	 * Whether the document has been closed
	 */
	is_closed: boolean;

	/**
	 * Whether the document has been modified
	 */
	is_dirty: boolean;

	/**
	 * Whether the document is untitled
	 */
	is_untitled: boolean;

	/**
	 * Language identifier
	 */
	language_id: string;

	/**
	 * Number of lines in the document
	 */
	line_count: number;

	/**
	 * Version number of the document
	 */
	version: number;

}

/**
 * A line and character position, such as the position of the cursor.
 */
export interface Position {
	/**
	 * The zero-based character value, as a Unicode code point offset.
	 */
	character: number;

	/**
	 * The zero-based line value.
	 */
	line: number;

}

/**
 * Selection metadata
 */
export interface Selection {
	/**
	 * Position of the cursor.
	 */
	active: Position;

	/**
	 * Start position of the selection
	 */
	start: Position;

	/**
	 * End position of the selection
	 */
	end: Position;

	/**
	 * Text of the selection
	 */
	text: string;

}

/**
 * Selection range
 */
export interface Range {
	/**
	 * Start position of the selection
	 */
	start: Position;

	/**
	 * End position of the selection
	 */
	end: Position;

}

/**
 * Parameters for the Busy method.
 */
export interface BusyParams {
	/**
	 * Whether the backend is busy
	 */
	busy: boolean;
}

/**
 * Parameters for the OpenEditor method.
 */
export interface OpenEditorParams {
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
 * Parameters for the NewDocument method.
 */
export interface NewDocumentParams {
	/**
	 * Document contents
	 */
	contents: string;

	/**
	 * Language identifier
	 */
	language_id: string;
}

/**
 * Parameters for the ShowMessage method.
 */
export interface ShowMessageParams {
	/**
	 * The message to show to the user.
	 */
	message: string;
}

/**
 * Parameters for the ShowQuestion method.
 */
export interface ShowQuestionParams {
	/**
	 * The title of the dialog
	 */
	title: string;

	/**
	 * The message to display in the dialog
	 */
	message: string;

	/**
	 * The title of the OK button
	 */
	ok_button_title: string;

	/**
	 * The title of the Cancel button
	 */
	cancel_button_title: string;
}

/**
 * Parameters for the ShowDialog method.
 */
export interface ShowDialogParams {
	/**
	 * The title of the dialog
	 */
	title: string;

	/**
	 * The message to display in the dialog
	 */
	message: string;
}

/**
 * Parameters for the AskForPassword method.
 */
export interface AskForPasswordParams {
	/**
	 * The prompt, such as 'Please enter your password'
	 */
	prompt: string;
}

/**
 * Parameters for the PromptState method.
 */
export interface PromptStateParams {
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
 * Parameters for the WorkingDirectory method.
 */
export interface WorkingDirectoryParams {
	/**
	 * The new working directory
	 */
	directory: string;
}

/**
 * Parameters for the DebugSleep method.
 */
export interface DebugSleepParams {
	/**
	 * Duration in milliseconds
	 */
	ms: number;
}

/**
 * Parameters for the ExecuteCommand method.
 */
export interface ExecuteCommandParams {
	/**
	 * The command to execute
	 */
	command: string;
}

/**
 * Parameters for the EvaluateWhenClause method.
 */
export interface EvaluateWhenClauseParams {
	/**
	 * The values for context keys, as a `when` clause
	 */
	when_clause: string;
}

/**
 * Parameters for the ExecuteCode method.
 */
export interface ExecuteCodeParams {
	/**
	 * The language ID of the code to execute
	 */
	language_id: string;

	/**
	 * The code to execute
	 */
	code: string;

	/**
	 * Whether to focus the runtime's console
	 */
	focus: boolean;

	/**
	 * Whether to bypass runtime code completeness checks
	 */
	allow_incomplete: boolean;
}

/**
 * Parameters for the OpenWorkspace method.
 */
export interface OpenWorkspaceParams {
	/**
	 * The path for the workspace to be opened
	 */
	path: string;

	/**
	 * Should the workspace be opened in a new window?
	 */
	new_window: boolean;
}

/**
 * Parameters for the SetEditorSelections method.
 */
export interface SetEditorSelectionsParams {
	/**
	 * The selections (really, ranges) to set in the document
	 */
	selections: Array<Range>;
}

/**
 * Parameters for the ModifyEditorSelections method.
 */
export interface ModifyEditorSelectionsParams {
	/**
	 * The selections (really, ranges) to set in the document
	 */
	selections: Array<Range>;

	/**
	 * The text values to insert at the selections
	 */
	values: Array<string>;
}

/**
 * Parameters for the ShowUrl method.
 */
export interface ShowUrlParams {
	/**
	 * The URL to display
	 */
	url: string;
}

/**
 * Parameters for the ShowHtmlFile method.
 */
export interface ShowHtmlFileParams {
	/**
	 * The fully qualified filesystem path to the HTML file to display
	 */
	path: string;

	/**
	 * A title to be displayed in the viewer. May be empty, and can be
	 * superseded by the title in the HTML file.
	 */
	title: string;

	/**
	 * Whether the HTML file is a plot-like object
	 */
	is_plot: boolean;

	/**
	 * The desired height of the HTML viewer, in pixels. The special value 0
	 * indicates that no particular height is desired, and -1 indicates that
	 * the viewer should be as tall as possible.
	 */
	height: number;
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

/**
 * Event: Open a workspace
 */
export interface OpenWorkspaceEvent {
	/**
	 * The path for the workspace to be opened
	 */
	path: string;

	/**
	 * Should the workspace be opened in a new window?
	 */
	new_window: boolean;

}

/**
 * Event: Set the selections in the editor
 */
export interface SetEditorSelectionsEvent {
	/**
	 * The selections (really, ranges) to set in the document
	 */
	selections: Array<Range>;

}

/**
 * Event: Show a URL in Positron's Viewer pane
 */
export interface ShowUrlEvent {
	/**
	 * The URL to display
	 */
	url: string;

}

/**
 * Event: Show an HTML file in Positron
 */
export interface ShowHtmlFileEvent {
	/**
	 * The fully qualified filesystem path to the HTML file to display
	 */
	path: string;

	/**
	 * A title to be displayed in the viewer. May be empty, and can be
	 * superseded by the title in the HTML file.
	 */
	title: string;

	/**
	 * Whether the HTML file is a plot-like object
	 */
	is_plot: boolean;

	/**
	 * The desired height of the HTML viewer, in pixels. The special value 0
	 * indicates that no particular height is desired, and -1 indicates that
	 * the viewer should be as tall as possible.
	 */
	height: number;

}

/**
 * Event: Webview preloads should be flushed
 */
export interface ClearWebviewPreloadsEvent {
}

/**
 * Request: Create a new document with text contents
 *
 * Use this to create a new document with the given language ID and text
 * contents
 */
export interface NewDocumentRequest {
	/**
	 * Document contents
	 */
	contents: string;

	/**
	 * Language identifier
	 */
	language_id: string;

}

/**
 * Request: Show a question
 *
 * Use this for a modal dialog that the user can accept or cancel
 */
export interface ShowQuestionRequest {
	/**
	 * The title of the dialog
	 */
	title: string;

	/**
	 * The message to display in the dialog
	 */
	message: string;

	/**
	 * The title of the OK button
	 */
	ok_button_title: string;

	/**
	 * The title of the Cancel button
	 */
	cancel_button_title: string;

}

/**
 * Request: Show a dialog
 *
 * Use this for a modal dialog that the user can only accept
 */
export interface ShowDialogRequest {
	/**
	 * The title of the dialog
	 */
	title: string;

	/**
	 * The message to display in the dialog
	 */
	message: string;

}

/**
 * Request: Ask the user for a password
 *
 * Use this for an input box where the user can input a password
 */
export interface AskForPasswordRequest {
	/**
	 * The prompt, such as 'Please enter your password'
	 */
	prompt: string;

}

/**
 * Request: Sleep for n seconds
 *
 * Useful for testing in the backend a long running frontend method
 */
export interface DebugSleepRequest {
	/**
	 * Duration in milliseconds
	 */
	ms: number;

}

/**
 * Request: Execute a Positron command
 *
 * Use this to execute a Positron command from the backend (like from a
 * runtime), and wait for the command to finish
 */
export interface ExecuteCommandRequest {
	/**
	 * The command to execute
	 */
	command: string;

}

/**
 * Request: Get a logical for a `when` clause (a set of context keys)
 *
 * Use this to evaluate a `when` clause of context keys in the frontend
 */
export interface EvaluateWhenClauseRequest {
	/**
	 * The values for context keys, as a `when` clause
	 */
	when_clause: string;

}

/**
 * Request: Execute code in a Positron runtime
 *
 * Use this to execute code in a Positron runtime
 */
export interface ExecuteCodeRequest {
	/**
	 * The language ID of the code to execute
	 */
	language_id: string;

	/**
	 * The code to execute
	 */
	code: string;

	/**
	 * Whether to focus the runtime's console
	 */
	focus: boolean;

	/**
	 * Whether to bypass runtime code completeness checks
	 */
	allow_incomplete: boolean;

}

/**
 * Request: Path to the workspace folder
 *
 * Returns the path to the workspace folder, or first folder if there are
 * multiple.
 */
export interface WorkspaceFolderRequest {
}

/**
 * Request: Modify selections in the editor with a text edit
 *
 * Use this to edit a set of selection ranges/cursor in the editor
 */
export interface ModifyEditorSelectionsRequest {
	/**
	 * The selections (really, ranges) to set in the document
	 */
	selections: Array<Range>;

	/**
	 * The text values to insert at the selections
	 */
	values: Array<string>;

}

/**
 * Request: Context metadata for the last editor
 *
 * Returns metadata such as file path for the last editor selected by the
 * user. The result may be undefined if there are no active editors.
 */
export interface LastActiveEditorContextRequest {
}

export enum UiFrontendEvent {
	Busy = 'busy',
	ClearConsole = 'clear_console',
	OpenEditor = 'open_editor',
	ShowMessage = 'show_message',
	PromptState = 'prompt_state',
	WorkingDirectory = 'working_directory',
	OpenWorkspace = 'open_workspace',
	SetEditorSelections = 'set_editor_selections',
	ShowUrl = 'show_url',
	ShowHtmlFile = 'show_html_file',
	ClearWebviewPreloads = 'clear_webview_preloads'
}

export enum UiFrontendRequest {
	NewDocument = 'new_document',
	ShowQuestion = 'show_question',
	ShowDialog = 'show_dialog',
	AskForPassword = 'ask_for_password',
	DebugSleep = 'debug_sleep',
	ExecuteCommand = 'execute_command',
	EvaluateWhenClause = 'evaluate_when_clause',
	ExecuteCode = 'execute_code',
	WorkspaceFolder = 'workspace_folder',
	ModifyEditorSelections = 'modify_editor_selections',
	LastActiveEditorContext = 'last_active_editor_context'
}

export enum UiBackendRequest {
	CallMethod = 'call_method'
}

export class PositronUiComm extends PositronBaseComm {
	constructor(
		instance: IRuntimeClientInstance<any, any>,
		options?: PositronCommOptions<UiBackendRequest>,
	) {
		super(instance, options);
		this.onDidBusy = super.createEventEmitter('busy', ['busy']);
		this.onDidClearConsole = super.createEventEmitter('clear_console', []);
		this.onDidOpenEditor = super.createEventEmitter('open_editor', ['file', 'line', 'column']);
		this.onDidShowMessage = super.createEventEmitter('show_message', ['message']);
		this.onDidPromptState = super.createEventEmitter('prompt_state', ['input_prompt', 'continuation_prompt']);
		this.onDidWorkingDirectory = super.createEventEmitter('working_directory', ['directory']);
		this.onDidOpenWorkspace = super.createEventEmitter('open_workspace', ['path', 'new_window']);
		this.onDidSetEditorSelections = super.createEventEmitter('set_editor_selections', ['selections']);
		this.onDidShowUrl = super.createEventEmitter('show_url', ['url']);
		this.onDidShowHtmlFile = super.createEventEmitter('show_html_file', ['path', 'title', 'is_plot', 'height']);
		this.onDidClearWebviewPreloads = super.createEventEmitter('clear_webview_preloads', []);
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
	callMethod(method: string, params: Array<Param>): Promise<CallMethodResult> {
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
	/**
	 * Open a workspace
	 *
	 * Use this to open a workspace in Positron
	 */
	onDidOpenWorkspace: Event<OpenWorkspaceEvent>;
	/**
	 * Set the selections in the editor
	 *
	 * Use this to set the selection ranges/cursor in the editor
	 */
	onDidSetEditorSelections: Event<SetEditorSelectionsEvent>;
	/**
	 * Show a URL in Positron's Viewer pane
	 *
	 * Causes the URL to be displayed inside the Viewer pane, and makes the
	 * Viewer pane visible.
	 */
	onDidShowUrl: Event<ShowUrlEvent>;
	/**
	 * Show an HTML file in Positron
	 *
	 * Causes the HTML file to be shown in Positron.
	 */
	onDidShowHtmlFile: Event<ShowHtmlFileEvent>;
	/**
	 * Webview preloads should be flushed
	 *
	 * This event is used to signal that the stored messages the front-end
	 * replays when constructing multi-output plots should be reset. This
	 * happens for things like a holoviews extension being changed.
	 */
	onDidClearWebviewPreloads: Event<ClearWebviewPreloadsEvent>;
}

