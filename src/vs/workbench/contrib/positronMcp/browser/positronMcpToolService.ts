/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IMcpCallToolResult } from '../../../../platform/positronMcp/common/positronMcpTools.js';

export const IPositronMcpToolService = createDecorator<IPositronMcpToolService>('positronMcpToolService');

/**
 * Renderer-side registry that runs MCP tools against the workbench services.
 *
 * The main-process MCP server brokers each `tools/call` to this service in the
 * pinned window (see PositronMcpToolBrokerChannel). Tools call services like
 * IRuntimeSessionService directly -- no extension-host RPC -- which is the whole
 * point of moving the server into core.
 */
export interface IPositronMcpToolService {
	readonly _serviceBrand: undefined;

	/** Run a tool by name and return its MCP result. Unknown tools return an error result. */
	callTool(name: string, args: Record<string, unknown>): Promise<IMcpCallToolResult>;

	/** Clear all cached code-execution consent, so the next agent-run code prompts again. */
	resetConsent(): void;

	/** Whether the user has allowed all agent code execution for this session. */
	isAllowAllConsentActive(): boolean;
}
