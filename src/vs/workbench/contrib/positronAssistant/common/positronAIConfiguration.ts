/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import {
	ConfigurationScope,
	Extensions,
	IConfigurationNode,
	IConfigurationPropertySchema,
	IConfigurationRegistry,
} from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { AI_ENABLED_KEY, AGENT_SESSIONS_ENABLED_KEY, DEFAULT_ERROR_ACTION_HANDLER_ID, ERROR_ACTIONS_AGENT_KEY, MCP_ENABLED_KEY, MCP_STATUS_BAR_KEY } from './positronAIConfigurationKeys.js';

// Re-exported so existing importers do not have to move. New callers outside
// the workbench (e.g. the extension host) should import the keys module
// directly to avoid this file's registerConfiguration side effect.
export { AI_ENABLED_KEY, AGENT_SESSIONS_ENABLED_KEY };

/** The name of the default error action handler in the setting's choices. */
const DEFAULT_ERROR_ACTION_HANDLER_LABEL = localize('positron.ai.errorActions.agent.positAssistant', "Posit Assistant");

/**
 * The schema of {@link ERROR_ACTIONS_AGENT_KEY}. Its choices are set by
 * {@link setErrorActionHandlerChoices}.
 */
const errorActionHandlerSchema: IConfigurationPropertySchema = {
	type: 'string',
	default: DEFAULT_ERROR_ACTION_HANDLER_ID,
	// The default is listed even before it registers, so the setting's own
	// default is always a valid choice.
	enum: [DEFAULT_ERROR_ACTION_HANDLER_ID],
	enumItemLabels: [DEFAULT_ERROR_ACTION_HANDLER_LABEL],
	description: localize(
		'positron.ai.errorActions.agent',
		"Controls which coding agent handles Fix and Explain on console, notebook, and Quarto errors."
	),
	scope: ConfigurationScope.WINDOW,
	// An untrusted workspace can't choose where errors are sent.
	restricted: true,
};

const configurationRegistry = Registry.as<IConfigurationRegistry>(Extensions.Configuration);
const aiConfigurationNode: IConfigurationNode = {
	id: 'ai',
	order: 5,
	title: localize('positron.ai.title', "AI"),
	type: 'object',
	properties: {
		[AI_ENABLED_KEY]: {
			type: 'boolean',
			default: true,
			description: localize(
				'positron.ai.enabled',
				"Enable Positron's AI features, such as Posit Assistant, Posit AI Next Edit Suggestions and AI features in notebooks and the console. When disabled, all of Positron's AI features are turned off."
			),
			scope: ConfigurationScope.WINDOW,
		},
		[ERROR_ACTIONS_AGENT_KEY]: errorActionHandlerSchema,
		[MCP_ENABLED_KEY]: {
			type: 'boolean',
			default: false,
			markdownDescription: localize(
				'positron.ai.mcp.enabled',
				"Let external coding agents run code in this window's Python and R sessions, and run Positron commands, through a Positron MCP server."
			),
			scope: ConfigurationScope.WINDOW,
			tags: ['experimental'],
			order: 1,
		},
		[MCP_STATUS_BAR_KEY]: {
			type: 'boolean',
			default: false,
			markdownDescription: localize(
				'positron.ai.mcp.statusBar',
				"Show the coding agents connected to this window's sessions in the status bar."
			),
			scope: ConfigurationScope.WINDOW,
			tags: ['experimental'],
			order: 2,
		},
		[AGENT_SESSIONS_ENABLED_KEY]: {
			type: 'boolean',
			default: false,
			markdownDescription: localize(
				'positron.ai.agentSessions.enabled',
				"Let AI agents work in console sessions of their own. Under active development."
			),
			scope: ConfigurationScope.WINDOW,
			tags: ['experimental'],
			order: 3,
		}
	}
};
configurationRegistry.registerConfiguration(aiConfigurationNode);

/**
 * Set the choices the Settings editor lists for {@link ERROR_ACTIONS_AGENT_KEY}:
 * the default handler, always first and listed once, then the others. A
 * value that isn't one of them, e.g. an uninstalled assistant's, is kept and
 * flagged by the Settings editor.
 * @param assistants The registered assistants, in the order to list them.
 */
export function setErrorActionHandlerChoices(assistants: readonly { readonly id: string; readonly label: string }[]): void {
	const others = assistants.filter(assistant => assistant.id !== DEFAULT_ERROR_ACTION_HANDLER_ID);
	errorActionHandlerSchema.enum = [DEFAULT_ERROR_ACTION_HANDLER_ID, ...others.map(assistant => assistant.id)];
	errorActionHandlerSchema.enumItemLabels = [DEFAULT_ERROR_ACTION_HANDLER_LABEL, ...others.map(assistant => assistant.label)];
	configurationRegistry.notifyConfigurationSchemaUpdated(aiConfigurationNode);
}
