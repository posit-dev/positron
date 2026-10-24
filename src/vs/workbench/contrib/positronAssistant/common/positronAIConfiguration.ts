/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { equals } from '../../../../base/common/arrays.js';
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

/** The name of the default error action handler, in the setting's choices and on its buttons. */
export const DEFAULT_ERROR_ACTION_HANDLER_LABEL = localize('positron.ai.errorActions.agent.positAssistant', "Posit Assistant");

// The choices of ERROR_ACTIONS_AGENT_KEY, set by setErrorActionHandlerChoices. The
// default is listed even before it registers, so the setting's own default is
// always a valid choice.
const errorActionHandlerChoiceIds: string[] = [DEFAULT_ERROR_ACTION_HANDLER_ID];
const errorActionHandlerChoiceLabels: string[] = [DEFAULT_ERROR_ACTION_HANDLER_LABEL];

/** The schema of {@link ERROR_ACTIONS_AGENT_KEY}. */
const errorActionHandlerSchema: IConfigurationPropertySchema = {
	type: 'string',
	default: DEFAULT_ERROR_ACTION_HANDLER_ID,
	enum: errorActionHandlerChoiceIds,
	enumItemLabels: errorActionHandlerChoiceLabels,
	description: localize(
		'positron.ai.errorActions.agent',
		"Controls which coding agent handles Fix and Explain on console, notebook, and Quarto errors."
	),
	// Coding agents are installed per host, so a choice in local user settings
	// doesn't apply in a remote window. Workspace settings can still choose.
	scope: ConfigurationScope.MACHINE_OVERRIDABLE,
	// An untrusted workspace can't choose where errors are sent, and nor can
	// an extension's configuration defaults.
	restricted: true,
	disallowConfigurationDefault: true,
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
 * the default handler, always first and listed once, then the others.
 * @param choices The handlers to list, in order.
 */
export function setErrorActionHandlerChoices(choices: readonly { readonly id: string; readonly label: string }[]): void {
	const others = choices.filter(choice => choice.id !== DEFAULT_ERROR_ACTION_HANDLER_ID);
	const ids = [DEFAULT_ERROR_ACTION_HANDLER_ID, ...others.map(choice => choice.id)];
	const labels = [DEFAULT_ERROR_ACTION_HANDLER_LABEL, ...others.map(choice => choice.label)];
	// A schema update re-renders the Settings editor, so skip it when nothing changed.
	if (equals(errorActionHandlerChoiceIds, ids) && equals(errorActionHandlerChoiceLabels, labels)) {
		return;
	}
	// Update in place, since the Settings editor caches the schema's arrays.
	errorActionHandlerChoiceIds.splice(0, errorActionHandlerChoiceIds.length, ...ids);
	errorActionHandlerChoiceLabels.splice(0, errorActionHandlerChoiceLabels.length, ...labels);
	configurationRegistry.notifyConfigurationSchemaUpdated(aiConfigurationNode);
}
