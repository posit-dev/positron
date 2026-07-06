/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IMcpCallerContext } from '../../../../platform/positronMcp/common/positronMcp.js';
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

	/**
	 * Run a tool by name and return its MCP result. Unknown tools return an error
	 * result. The caller context, when present, names the agent for consent
	 * dialogs and per-client consent scoping.
	 */
	callTool(name: string, args: Record<string, unknown>, caller?: IMcpCallerContext): Promise<IMcpCallToolResult>;

	/** Clear all cached code-execution consent, so the next agent-run code prompts again. */
	resetConsent(): void;

	/** Whether the user has allowed all agent code execution for this session. */
	isAllowAllConsentActive(): boolean;

	/** Fires with the new value when the allow-all consent decision is granted or reset. */
	readonly onDidChangeAllowAllConsent: Event<boolean>;

	/**
	 * The caller of the tool call currently executing in this window, if any.
	 * The context observer reads this to attribute workbench events an MCP tool
	 * causes (an editor opened by open-document, a notebook created by
	 * notebook-create) to the client behind it, so that client is never alerted
	 * about its own actions. When calls from several clients overlap, the most
	 * recently started one wins -- a rare ambiguity that only softens alert
	 * attribution, never consent.
	 */
	readonly activeCaller: IMcpCallerContext | undefined;
}
