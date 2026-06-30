/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';
import { IMcpCallToolResult, McpContent } from '../../../../platform/positronMcp/common/positronMcpTools.js';
import { IPositronMcpToolService } from './positronMcpToolService.js';
import { textResult } from './positronMcpFormat.js';

/** A tool handler: receives its arguments, returns an MCP result. */
type ToolHandler = (args: Record<string, unknown>) => Promise<IMcpCallToolResult>;

/**
 * Renderer-side MCP tool registry. Each tool calls workbench services directly.
 * Phase 2 implements get-session; later phases register the remaining tools.
 */
export class PositronMcpToolService extends Disposable implements IPositronMcpToolService {
	declare readonly _serviceBrand: undefined;

	private readonly _handlers = new Map<string, ToolHandler>();

	constructor(
		@IRuntimeSessionService private readonly _runtimeSessionService: IRuntimeSessionService,
	) {
		super();
		this._handlers.set('get-session', () => this._getSession());
	}

	async callTool(name: string, args: Record<string, unknown>): Promise<IMcpCallToolResult> {
		const handler = this._handlers.get(name);
		if (!handler) {
			const content: McpContent[] = [{ type: 'text', text: `Tool '${name}' is not implemented in this Positron window.` }];
			return { content, isError: true };
		}
		return handler(args);
	}

	private async _getSession(): Promise<IMcpCallToolResult> {
		const session = this._runtimeSessionService.foregroundSession;
		if (!session) {
			return textResult('No active runtime session. Use session-start to begin one.');
		}
		return textResult([
			`Runtime Session: ${session.dynState.sessionName}`,
			`Language: ${session.runtimeMetadata.languageId}`,
			`Mode: ${session.metadata.sessionMode}`,
			`Session ID: ${session.metadata.sessionId}`,
		].join('\n'));
	}
}
