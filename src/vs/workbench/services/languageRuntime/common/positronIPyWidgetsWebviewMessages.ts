/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

//
// Messages from the webview.
//

export interface ICommCloseFromWebview {
	type: 'comm_close';
	comm_id: string;
}

export interface ICommMessageFromWebview {
	type: 'comm_msg';
	comm_id: string;
	msg_id: string;
	data: unknown;
}

export interface ICommOpenFromWebview {
	type: 'comm_open';
	comm_id: string;
	target_name: string;
	data: unknown;
	metadata: unknown;
}

export interface IGetPreferredRendererFromWebview {
	type: 'get_preferred_renderer';
	msg_id: string;
	mime_type: string;
}

export interface IInitializeRequestFromWebview {
	type: 'initialize_request';
}

export interface IRegisterMessageHandlerFromWebview {
	type: 'register_message_handler';
	msg_id: string;
}

export type FromWebviewMessage = ICommCloseFromWebview |
	ICommMessageFromWebview |
	ICommOpenFromWebview |
	IGetPreferredRendererFromWebview |
	IInitializeRequestFromWebview |
	IRegisterMessageHandlerFromWebview;

//
// Messages to the webview.
//

export interface IInitializeResultToWebview {
	type: 'initialize_result';
}

export interface ICommCloseToWebview {
	type: 'comm_close';
	comm_id: string;
}

export interface ICommMessageToWebview {
	type: 'comm_msg';
	comm_id: string;
	data: unknown;
	buffers?: Array<Uint8Array>;
	/** If this is an RPC response, the ID of the RPC request message. */
	parent_id?: string;
}

export interface ICommOpenToWebview {
	type: 'comm_open';
	comm_id: string;
	target_name: string;
	data: unknown;
	metadata: unknown;
}

export interface IGetPreferredRendererResultToWebview {
	type: 'get_preferred_renderer_result';
	parent_id: string;
	/** The preferred renderer ID, or undefined if none found. */
	renderer_id?: string;
}

export interface IKernelMessageClearOutput {
	output_type: 'clear_output';
	wait: boolean;
}

export interface IKernelMessageDisplayData {
	output_type: 'display_data';
	data: unknown;
	metadata: unknown;
}

export interface IKernelMessageError {
	output_type: 'error';
	name: string;
	message: string;
	traceback: Array<string>;
}

export interface IKernelMessageExecuteResult {
	output_type: 'execute_result';
	// TODO: Runtime message doesn't currently include this...
	// execution_count: number | null;
	data: unknown;
	metadata: unknown;
}

export interface IKernelMessageStream {
	output_type: 'stream';
	name: 'stdout' | 'stderr';
	text: string;
}

export interface IKernelMessageToWebview {
	type: 'kernel_message';
	parent_id: string;
	content: IKernelMessageClearOutput |
	IKernelMessageDisplayData |
	IKernelMessageError |
	IKernelMessageExecuteResult |
	IKernelMessageStream;
}

export type ToWebviewMessage = IInitializeResultToWebview |
	ICommCloseToWebview |
	ICommMessageToWebview |
	ICommOpenToWebview |
	IGetPreferredRendererResultToWebview |
	IKernelMessageToWebview;
