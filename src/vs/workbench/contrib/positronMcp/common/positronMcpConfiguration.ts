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

// The `positron.mcp.*` keys keep their existing namespace rather than dropping
// the `positron.` prefix the configuration guidance would otherwise call for:
// the keys are a public contract (users' settings and `.mcp.json` files already
// use them, and the positron-mcp extension declares the same keys), so renaming
// would break existing configs and the coexistence story. While the extension
// is enabled it registers these keys first and core's registration is a no-op
// (duplicate property keys are skipped); once the extension is removed in a
// later phase, this registration keeps the settings alive.
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
	},
});
