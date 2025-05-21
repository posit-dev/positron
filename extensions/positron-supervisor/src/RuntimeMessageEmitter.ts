/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
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
import { JupyterInputRequest } from './jupyter/JupyterInputRequest';
import { isEnumMember } from './util.js';
import { JupyterMessageType } from './jupyter/JupyterMessageType.js';

/**
 * An emitter for runtime messages; translates Jupyter messages into language
 * runtime messages and emits them to Positron.
 */
export class RuntimeMessageEmitter {

	private readonly _emitter: vscode.EventEmitter<positron.LanguageRuntimeMessage>;

	constructor() {
		this._emitter = new vscode.EventEmitter<positron.LanguageRuntimeMessage>();
	}

	public get event(): vscode.Event<positron.LanguageRuntimeMessage> {
		return this._emitter.event;
	}

	/**
	 * Main entry point for message router; consumes a Jupyter message and emits
	 * a corresponding LanguageRuntimeMessage.
	 *
	 * @param msg The Jupyter message to be emitted
	 */
	public emitJupyter(msg: JupyterMessage): void {
		switch (msg.header.msg_type) {
			case JupyterMessageType.ClearOutput:
				this.onClearOutput(msg, msg.content as JupyterClearOutput);
				break;
			case JupyterMessageType.CommMsg:
				this.onCommMessage(msg, msg.content as JupyterCommMsg);
				break;
			case JupyterMessageType.CommOpen:
				this.onCommOpen(msg, msg.content as JupyterCommOpen);
				break;
			case JupyterMessageType.DisplayData:
				this.onDisplayData(msg, msg.content as JupyterDisplayData);
				break;
			case JupyterMessageType.Error:
				this.onErrorResult(msg, msg.content as JupyterErrorReply);
				break;
			case JupyterMessageType.ExecuteInput:
				this.onExecuteInput(msg, msg.content as JupyterExecuteInput);
				break;
			case JupyterMessageType.ExecuteResult:
				this.onExecuteResult(msg, msg.content as JupyterExecuteResult);
				break;
			case JupyterMessageType.InputRequest:
				this.onInputRequest(msg, msg.content as JupyterInputRequest);
				break;
			case JupyterMessageType.Status:
				this.onKernelStatus(msg, msg.content as JupyterKernelStatus);
				break;
			case JupyterMessageType.Stream:
				this.onStreamOutput(msg, msg.content as JupyterStreamOutput);
				break;
		}
	}

	/**
	 * Delivers a comm_msg message from the kernel to the appropriate client instance.
	 *
	 * @param message The outer message packet
	 * @param msg The inner comm_msg message
	 */
	private onCommMessage(message: JupyterMessage, data: JupyterCommMsg): void {
		const runtimeMessage: positron.LanguageRuntimeCommMessage = {
			id: message.header.msg_id,
			parent_id: message.parent_header?.msg_id,
			when: message.header.date,
			type: positron.LanguageRuntimeMessageType.CommData,
			comm_id: data.comm_id,
			data: data.data,
			metadata: message.metadata,
			buffers: message.buffers,
		};
		this._emitter.fire(runtimeMessage);
	}

	/**
	 * Converts a Jupyter execute_result message to a LanguageRuntimeMessage and
	 * emits it.
	 *
	 * @param message The message packet
	 * @param data The execute_result message
	 */
	onExecuteResult(message: JupyterMessage, data: JupyterExecuteResult) {
		const runtimeMessage: positron.LanguageRuntimeResult = {
			id: message.header.msg_id,
			parent_id: message.parent_header?.msg_id,
			when: message.header.date,
			type: positron.LanguageRuntimeMessageType.Result,
			data: data.data,
			metadata: message.metadata,
		};
		this._emitter.fire(runtimeMessage);
	}

	/**
	 * Converts a Jupyter display_data message to a LanguageRuntimeMessage and
	 * emits it.
	 *
	 * @param message The message packet
	 * @param data The display_data message
	 */
	onDisplayData(message: JupyterMessage, data: JupyterDisplayData) {
		const runtimeMessage: positron.LanguageRuntimeOutput = {
			id: message.header.msg_id,
			parent_id: message.parent_header?.msg_id,
			when: message.header.date,
			type: positron.LanguageRuntimeMessageType.Output,
			data: data.data,
			metadata: message.metadata,
		};
		this._emitter.fire(runtimeMessage);
	}

	/**
	 * Converts a Jupyter execute_input message to a LanguageRuntimeMessage and
	 * emits it.
	 *
	 * @param message The message packet
	 * @param data The execute_input message
	 */
	onExecuteInput(message: JupyterMessage, data: JupyterExecuteInput) {
		const runtimeMessage: positron.LanguageRuntimeInput = {
			id: message.header.msg_id,
			parent_id: message.parent_header?.msg_id,
			when: message.header.date,
			type: positron.LanguageRuntimeMessageType.Input,
			code: data.code,
			execution_count: data.execution_count,
			metadata: message.metadata,
		};
		this._emitter.fire(runtimeMessage);
	}

	/**
	 * Converts a Jupyter status message to a LanguageRuntimeMessage and emits
	 * it.
	 *
	 * @param message The message packet
	 * @param data The kernel status message
	 */
	onKernelStatus(message: JupyterMessage, data: JupyterKernelStatus) {
		if (!isEnumMember(data.execution_state, positron.RuntimeOnlineState)) {
			throw new Error(`Unexpected JupyterKernelStatus.execution_state: ${data.execution_state}`);
		}
		const runtimeMessage: positron.LanguageRuntimeState = {
			id: message.header.msg_id,
			parent_id: message.parent_header?.msg_id,
			when: message.header.date,
			type: positron.LanguageRuntimeMessageType.State,
			state: data.execution_state,
			metadata: message.metadata,
		};
		this._emitter.fire(runtimeMessage);
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
		const runtimeMessage: positron.LanguageRuntimeCommOpen = {
			id: message.header.msg_id,
			parent_id: message.parent_header?.msg_id,
			when: message.header.date,
			type: positron.LanguageRuntimeMessageType.CommOpen,
			comm_id: data.comm_id,
			target_name: data.target_name,
			data: data.data,
			metadata: message.metadata,
			buffers: message.buffers,
		};
		this._emitter.fire(runtimeMessage);
	}

	/**
	 * Converts a Jupyter clear_output message to a LanguageRuntimeMessage and
	 * emits it.
	 *
	 * @param message The message packet
	 * @param data The clear_output message
	 */
	onClearOutput(message: JupyterMessage, data: JupyterClearOutput) {
		const runtimeMessage: positron.LanguageRuntimeClearOutput = {
			id: message.header.msg_id,
			parent_id: message.parent_header?.msg_id,
			when: message.header.date,
			type: positron.LanguageRuntimeMessageType.ClearOutput,
			wait: data.wait,
			metadata: message.metadata,
		};
		this._emitter.fire(runtimeMessage);
	}

	/**
	 * Converts a Jupyter error message to a LanguageRuntimeMessage and emits
	 * it.
	 *
	 * @param message The message packet
	 * @param data The error message
	 */
	private onErrorResult(message: JupyterMessage, data: JupyterErrorReply) {
		const runtimeMessage: positron.LanguageRuntimeError = {
			id: message.header.msg_id,
			parent_id: message.parent_header?.msg_id,
			when: message.header.date,
			type: positron.LanguageRuntimeMessageType.Error,
			name: data.ename,
			message: data.evalue,
			traceback: data.traceback,
			metadata: message.metadata,
		};
		this._emitter.fire(runtimeMessage);
	}

	/**
	 * Converts a Jupyter stream message to a LanguageRuntimeMessage and
	 * emits it.
	 *
	 * @param message The message packet
	 * @param data The stream message
	 */
	private onStreamOutput(message: JupyterMessage, data: JupyterStreamOutput) {
		if (!isEnumMember(data.name, positron.LanguageRuntimeStreamName)) {
			throw new Error(`Unexpected JupyterStreamOutput.name: ${data.name}`);
		}
		const runtimeMessage: positron.LanguageRuntimeStream = {
			id: message.header.msg_id,
			parent_id: message.parent_header?.msg_id,
			when: message.header.date,
			type: positron.LanguageRuntimeMessageType.Stream,
			name: data.name,
			text: data.text,
			metadata: message.metadata,
		};
		this._emitter.fire(runtimeMessage);
	}

	/**
	 * Handles an input_request message from the kernel.
	 *
	 * @param message The message packet
	 * @param req The input request
	 */
	private onInputRequest(message: JupyterMessage, req: JupyterInputRequest): void {
		const runtimeMessage: positron.LanguageRuntimePrompt = {
			id: message.header.msg_id,
			parent_id: message.parent_header?.msg_id,
			when: message.header.date,
			type: positron.LanguageRuntimeMessageType.Prompt,
			prompt: req.prompt,
			password: req.password,
		};
		this._emitter.fire(runtimeMessage);
	}

}
