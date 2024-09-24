/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as positron from 'positron';
import { JupyterMessage } from './jupyter/JupyterMessage';
import { JupyterKernelStatus } from './jupyter/JupyterKernelStatus';
import { JupyterExecuteInput } from './jupyter/JupyterExecuteInput';
import { JupyterExecuteResult } from './jupyter/ExecuteRequest';
import { JupyterDisplayData } from './jupyter/JupyterDisplayData';
import { JupyterCommMsg } from './jupyter/JupyterCommMsg';
import { JupyterCommOpen } from './jupyter/JupyterCommOpen';
import { JupyterClearOutput } from './jupyter/JupyterClearOutput';
import { JupyterErrorReply } from './jupyter/JupyterErrorReply';
import { JupyterStreamOutput } from './jupyter/JupyterStreamOutput';

export class RuntimeMessageEmitter {

	private readonly _emitter: vscode.EventEmitter<positron.LanguageRuntimeMessage>;

	constructor() {
		this._emitter = new vscode.EventEmitter<positron.LanguageRuntimeMessage>();
	}

	public get event(): vscode.Event<positron.LanguageRuntimeMessage> {
		return this._emitter.event;
	}

	public emitJupyter(msg: JupyterMessage): void {
		switch (msg.header.msg_type) {
			case 'comm_msg':
				this.onCommMessage(msg, msg.content as JupyterCommMsg);
				break;
			case 'comm_open':
				this.onCommOpen(msg, msg.content as JupyterCommOpen);
			case 'display_data':
				this.onDisplayData(msg, msg.content as JupyterDisplayData);
				break;
			case 'error':
				this.onErrorResult(msg, msg.content as JupyterErrorReply);
				break;
			case 'execute_input':
				this.onExecuteInput(msg, msg.content as JupyterExecuteInput);
				break;
			case 'execute_result':
				this.onExecuteResult(msg, msg.content as JupyterExecuteResult);
				break;
			case 'status':
				this.onKernelStatus(msg, msg.content as JupyterKernelStatus);
				break;
			case 'stream':
				this.onStreamOutput(msg, msg.content as JupyterStreamOutput);
		}
	}

	/**
	 * Delivers a comm_msg message from the kernel to the appropriate client instance.
	 *
	 * @param message The outer message packet
	 * @param msg The inner comm_msg message
	 */
	private onCommMessage(message: JupyterMessage, data: JupyterCommMsg): void {
		this._emitter.fire({
			id: message.header.msg_id,
			parent_id: message.parent_header?.msg_id,
			when: message.header.date,
			type: positron.LanguageRuntimeMessageType.CommData,
			comm_id: data.comm_id,
			data: data.data,
			metadata: message.metadata,
			buffers: message.buffers,
		} as positron.LanguageRuntimeCommMessage);
	}

	/**
	 * Converts a Jupyter execute_result message to a LanguageRuntimeMessage and
	 * emits it.
	 *
	 * @param message The message packet
	 * @param data The execute_result message
	 */
	onExecuteResult(message: JupyterMessage, data: JupyterExecuteResult) {
		this._emitter.fire({
			id: message.header.msg_id,
			parent_id: message.parent_header?.msg_id,
			when: message.header.date,
			type: positron.LanguageRuntimeMessageType.Result,
			data: data.data as any,
			metadata: message.metadata,
		} as positron.LanguageRuntimeResult);
	}

	/**
	 * Converts a Jupyter display_data message to a LanguageRuntimeMessage and
	 * emits it.
	 *
	 * @param message The message packet
	 * @param data The display_data message
	 */
	onDisplayData(message: JupyterMessage, data: JupyterDisplayData) {
		this._emitter.fire({
			id: message.header.msg_id,
			parent_id: message.parent_header?.msg_id,
			when: message.header.date,
			type: positron.LanguageRuntimeMessageType.Output,
			data: data.data as any,
			metadata: message.metadata,
		} as positron.LanguageRuntimeOutput);
	}

	/**
	 * Converts a Jupyter execute_input message to a LanguageRuntimeMessage and
	 * emits it.
	 *
	 * @param message The message packet
	 * @param data The execute_input message
	 */
	onExecuteInput(message: JupyterMessage, data: JupyterExecuteInput) {
		this._emitter.fire({
			id: message.header.msg_id,
			parent_id: message.parent_header?.msg_id,
			when: message.header.date,
			type: positron.LanguageRuntimeMessageType.Input,
			code: data.code,
			execution_count: data.execution_count,
			metadata: message.metadata,
		} as positron.LanguageRuntimeInput);
	}

	/**
	 * Converts a Jupyter status message to a LanguageRuntimeMessage and emits
	 * it.
	 *
	 * @param message The message packet
	 * @param data The kernel status message
	 */
	onKernelStatus(message: JupyterMessage, data: JupyterKernelStatus) {
		this._emitter.fire({
			id: message.header.msg_id,
			parent_id: message.parent_header?.msg_id,
			when: message.header.date,
			type: positron.LanguageRuntimeMessageType.State,
			state: data.execution_state,
			metadata: message.metadata,
		} as positron.LanguageRuntimeState);
	}

	/**
	 * Delivers a comm_open message from the kernel to the front end. Typically
	 * this is used to create a front-end representation of a back-end
	 * object, such as an interactive plot or Jupyter widget.
	 *
	 * @param message The outer message packet
	 * @param data The inner comm_open message
	 */
	private onCommOpen(message: JupyterMessage, data: JupyterCommOpen): void {
		this._emitter.fire({
			id: message.header.msg_id,
			parent_id: message.parent_header?.msg_id,
			when: message.header.date,
			type: positron.LanguageRuntimeMessageType.CommOpen,
			comm_id: data.comm_id,
			target_name: data.target_name,
			data: data.data,
			metadata: message.metadata,
		} as positron.LanguageRuntimeCommOpen);
	}

	/**
	 * Converts a Jupyter clear_output message to a LanguageRuntimeMessage and
	 * emits it.
	 *
	 * @param message The message packet
	 * @param data The clear_output message
	 */
	onClearOutput(message: JupyterMessage, data: JupyterClearOutput) {
		this._emitter.fire({
			id: message.header.msg_id,
			parent_id: message.parent_header?.msg_id,
			when: message.header.date,
			type: positron.LanguageRuntimeMessageType.ClearOutput,
			wait: data.wait,
			metadata: message.metadata,
		} as positron.LanguageRuntimeClearOutput);
	}

	/**
	 * Converts a Jupyter error message to a LanguageRuntimeMessage and emits
	 * it.
	 *
	 * @param message The message packet
	 * @param data The error message
	 */
	private onErrorResult(message: JupyterMessage, data: JupyterErrorReply) {
		this._emitter.fire({
			id: message.header.msg_id,
			parent_id: message.parent_header?.msg_id,
			when: message.header.date,
			type: positron.LanguageRuntimeMessageType.Error,
			name: data.ename,
			message: data.evalue,
			traceback: data.traceback,
			metadata: message.metadata,
		} as positron.LanguageRuntimeError);
	}

	/**
	 * Converts a Jupyter stream message to a LanguageRuntimeMessage and
	 * emits it.
	 *
	 * @param message The message packet
	 * @param data The stream message
	 */
	private onStreamOutput(message: JupyterMessage, data: JupyterStreamOutput) {
		this._emitter.fire({
			id: message.header.msg_id,
			parent_id: message.parent_header?.msg_id,
			when: message.header.date,
			type: positron.LanguageRuntimeMessageType.Stream,
			name: data.name,
			text: data.text,
			metadata: message.metadata,
		} as positron.LanguageRuntimeStream);
	}

}
