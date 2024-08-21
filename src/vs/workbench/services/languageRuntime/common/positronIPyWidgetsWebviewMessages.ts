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

export type FromWebviewMessage = ICommCloseFromWebview |
	ICommMessageFromWebview |
	ICommOpenFromWebview |
	IGetPreferredRendererFromWebview |
	IInitializeRequestFromWebview;

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

export type ToWebviewMessage = IInitializeResultToWebview |
	ICommCloseToWebview |
	ICommMessageToWebview |
	ICommOpenToWebview |
	IGetPreferredRendererResultToWebview;
