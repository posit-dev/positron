/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { Extensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';

/**
 * Setting that turns the MCP server on. Default off. The server binds a fixed
 * port and exposes the user's session to external agents, so it stays opt-in.
 */
export const MCP_ENABLE_KEY = 'positron.mcp.enable';

/**
 * Per-call timeout (ms) for execute-code and other kernel-backed tools before
 * the tool reports the call as still running / not yet started. Does not stop
 * code that is genuinely running.
 */
export const EXECUTION_TIMEOUT_KEY = 'positron.mcp.executionTimeout';

/** Default for {@link EXECUTION_TIMEOUT_KEY} when unset. */
export const DEFAULT_EXECUTION_TIMEOUT = 30000;

/**
 * How much the JSONL audit file records per tool call. Values are
 * `McpAuditLogDetail` ('summary' | 'full' | 'off'); the lifecycle contribution
 * pushes the value to the main-process server, which owns the file sink.
 */
export const AUDIT_LOG_DETAIL_KEY = 'positron.mcp.auditLog.detail';

// The `positron.mcp.*` keys keep the `positron.` prefix the configuration
// guidance would otherwise drop: a bare `mcp.*` namespace would collide with
// upstream VS Code's own MCP-server settings, and these keys name a distinct
// feature (Positron exposing itself as an MCP server, not consuming ones).
const configurationRegistry = Registry.as<IConfigurationRegistry>(Extensions.Configuration);
configurationRegistry.registerConfiguration({
	id: 'positron.mcp',
	order: 100,
	title: localize('positron.mcp.title', "MCP"),
	type: 'object',
	properties: {
		[MCP_ENABLE_KEY]: {
			type: 'boolean',
			default: false,
			description: localize('positron.mcp.enable', "Enable the experimental Positron MCP server, which lets AI agents work in your live Positron session."),
		},
		[EXECUTION_TIMEOUT_KEY]: {
			type: 'number',
			default: DEFAULT_EXECUTION_TIMEOUT,
			description: localize('positron.mcp.executionTimeout', "Timeout in milliseconds for a single execute-code call before the MCP server reports it as still running or not yet started (for example, the console waiting on incomplete code). Does not stop code that is genuinely running."),
		},
		[AUDIT_LOG_DETAIL_KEY]: {
			type: 'string',
			enum: ['summary', 'full', 'off'],
			default: 'summary',
			enumDescriptions: [
				localize('positron.mcp.auditLog.detail.summary', "Record argument keys, safe scalar values, and truncated code previews."),
				localize('positron.mcp.auditLog.detail.full', "Record complete tool arguments, including full code and file paths. Result data is never recorded."),
				localize('positron.mcp.auditLog.detail.off', "Do not write an audit file."),
			],
			description: localize('positron.mcp.auditLog.detail', "How much detail the MCP audit file records about each tool call an AI agent makes. The file is one JSON event per line in the Positron logs folder and never leaves this machine, but with 'full' your code may appear in it verbatim."),
		},
	},
});
