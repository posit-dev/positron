/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Request the runtime to close a comm.
 *
 * For example, it's sent when the jupyter.widget.control comm is closed after fetching widget
 * state from the runtime.
 */
export interface ICommCloseFromWebview {
	type: 'comm_close';
	comm_id: string;
}

/**
 * Send a comm message to the runtime.
 */
export interface ICommMessageFromWebview {
	type: 'comm_msg';
	comm_id: string;
	msg_id: string;
	data: unknown;
}

/**
 * Request the runtime to open a comm.
 *
 * For example, it's sent to open a jupyter.widget.control comm to fetch widget state from the runtime.
 */
export interface ICommOpenFromWebview {
	type: 'comm_open';
	comm_id: string;
	target_name: string;
	data: unknown;
	metadata: unknown;
}

/**
 * Get the preferred VSCode notebook renderer for a given mime type.
 *
 * This is used inside the PositronRenderer to render sub-outputs inside an Output widget.
 */
export interface IGetPreferredRendererFromWebview {
	type: 'get_preferred_renderer';
	msg_id: string;
	mime_type: string;
}

/**
 * Notify the IPyWidgetsInstance that the webview is ready to receive messages.
 */
export interface IInitializeFromWebview {
	type: 'initialize';
}

/**
 * Messages sent from the webview to the PositronIPyWidgetsService.
 */
export type FromWebviewMessage = ICommCloseFromWebview |
	ICommMessageFromWebview |
	ICommOpenFromWebview |
	IGetPreferredRendererFromWebview |
	IInitializeFromWebview;

/**
 * Notify the webview that the IPyWidgetsInstance is ready to receive messages.
 */
export interface IInitializeResultToWebview {
	type: 'initialize_result';
}

/**
 * Notify the webview that the runtime has opened a comm.
 */
export interface ICommCloseToWebview {
	type: 'comm_close';
	comm_id: string;
}

/**
 * Notify the webview that the runtime has received a comm message.
 */
export interface ICommMessageToWebview {
	type: 'comm_msg';
	comm_id: string;
	data: unknown;
	buffers?: Array<Uint8Array>;
	/** If this is an RPC response, the ID of the RPC request message. */
	parent_id?: string;
}

/**
 * Notify the webview that the runtime has opened a comm.
 */
export interface ICommOpenToWebview {
	type: 'comm_open';
	comm_id: string;
	target_name: string;
	data: unknown;
	metadata: unknown;
}

/**
 * Response to a get_preferred_renderer request.
 */
export interface IGetPreferredRendererResultToWebview {
	type: 'get_preferred_renderer_result';
	/** The msg_id of the corresponding request message. */
	parent_id: string;
	/** The preferred renderer ID, or undefined if none was found. */
	renderer_id?: string;
}

/**
 * Content of a runtime clear_output message.
 */
export interface IRuntimeMessageClearOutput {
	type: 'clear_output';
	wait: boolean;
}

/**
 * Content of a runtime display_data message.
 */
export interface IRuntimeMessageDisplayData {
	type: 'display_data';
	data: unknown;
	metadata: unknown;
}

/**
 * Content of a runtime error message.
 */
export interface IRuntimeMessageError {
	type: 'error';
	name: string;
	message: string;
	traceback: Array<string>;
}

/**
 * Content of a runtime execute_result message.
 */
export interface IRuntimeMessageExecuteResult {
	type: 'execute_result';
	data: unknown;
	metadata: unknown;
}

/**
 * Content of a runtime stream message.
 */
export interface IRuntimeMessageStream {
	type: 'stream';
	name: 'stdout' | 'stderr';
	text: string;
}

/**
 * Content of a runtime message.
 */
export type IRuntimeMessageContent = IRuntimeMessageClearOutput |
	IRuntimeMessageDisplayData |
	IRuntimeMessageError |
	IRuntimeMessageExecuteResult |
	IRuntimeMessageStream;

/**
 * Notify the webview that the runtime has received a message.
 */
export interface IRuntimeMessageToWebview {
	type: 'kernel_message';
	parent_id: string;
	content: IRuntimeMessageContent;
}

/**
 * Messages sent from the PositronIPyWidgetsService to the webview.
 */
export type ToWebviewMessage = IInitializeResultToWebview |
	ICommCloseToWebview |
	ICommMessageToWebview |
	ICommOpenToWebview |
	IGetPreferredRendererResultToWebview |
	IRuntimeMessageToWebview;
