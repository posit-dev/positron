/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

export enum JupyterMessageType {
	ClearOutput = 'clear_output',
	CommClose = 'comm_close',
	CommInfoReply = 'comm_info_reply',
	CommInfoRequest = 'comm_info_request',
	CommMsg = 'comm_msg',
	CommOpen = 'comm_open',
	DebugEvent = 'debug_event',
	DebugRequest = 'debug_request',
	DebugReply = 'debug_reply',
	DisplayData = 'display_data',
	Error = 'error',
	ExecuteInput = 'execute_input',
	ExecuteReply = 'execute_reply',
	ExecuteRequest = 'execute_request',
	ExecuteResult = 'execute_result',
	InputReply = 'input_reply',
	InputRequest = 'input_request',
	IsCompleteReply = 'is_complete_reply',
	IsCompleteRequest = 'is_complete_request',
	KernelInfoReply = 'kernel_info_reply',
	KernelInfoRequest = 'kernel_info_request',
	RpcReply = 'rpc_reply',
	RpcRequest = 'rpc_request',
	ShutdownReply = 'shutdown_reply',
	ShutdownRequest = 'shutdown_request',
	Status = 'status',
	Stream = 'stream',
	UpdateDisplayData = 'update_display_data',
}
