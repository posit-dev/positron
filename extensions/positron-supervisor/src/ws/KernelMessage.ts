/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { SocketMessage } from './SocketMessage';

/**
 * Represents a status message from the kernel.
 */
export interface KernelMessageStatus extends SocketMessage {
	status: string;
}

/**
 * Represents a message from the kernel containing output.
 */
export interface KernelOutputMessage extends SocketMessage {
	/**
	 * A 2-element array containing the stream name and the output text.
	 */
	output: [string, string];
}

/**
 * Who asked for an execution the connected client did not submit itself.
 * Mirrors `ExecutionAttribution` in `kcshared`.
 */
export interface KernelExecutionAttribution {
	/** The kind of actor that requested the execution, e.g. 'agent'. */
	source: string;

	/** The name the agent reported in the MCP `clientInfo`, e.g. 'claude-code'. */
	agent_name?: string;

	/** The version the agent reported in the MCP `clientInfo`. */
	agent_version?: string;

	/** The MCP workspace whose token authorized the request. */
	workspace_id: string;

	/** The MCP tool used, e.g. 'execute_code' or 'evaluate_code'. */
	tool: string;
}

/**
 * Announces an execution submitted to the kernel by something other than this
 * client, such as an external agent using the supervisor's MCP server. Sent
 * before the resulting iopub traffic, so the client can attribute it.
 */
export interface KernelExecutionRequestedMessage extends SocketMessage {
	executionRequested: {
		/** The `execute_request` ID; the parent ID of everything it produces. */
		msg_id: string;

		/** The code that is about to run. */
		code: string;

		/** When the request was submitted, in ISO 8601 format. */
		requested_at: string;

		/** Who requested the execution. */
		attribution: KernelExecutionAttribution;
	};
}
