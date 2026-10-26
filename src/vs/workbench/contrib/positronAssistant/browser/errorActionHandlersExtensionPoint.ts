/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { ExtensionsRegistry } from '../../../services/extensions/common/extensionsRegistry.js';
import { IErrorActionHandlerContribution } from '../common/errorAction.js';

/** The activation event that starts the extension that contributes a handler. */
export function getErrorActionHandlerActivationEvent(id: string): string {
	return `onErrorActionHandler:${id}`;
}

/**
 * The `errorActionHandlers` contribution point. An extension declares each
 * handler it registers, which names it before the extension activates, and
 * lets Positron activate the extension when the handler is asked to take an
 * error before it has registered.
 */
ExtensionsRegistry.registerExtensionPoint<IErrorActionHandlerContribution[]>({
	extensionPoint: 'errorActionHandlers',
	jsonSchema: {
		description: localize('positron.vscode.extension.contributes.errorActionHandlers', "Contributes coding agents that the Fix and Explain actions on errors can be sent to."),
		type: 'array',
		items: {
			additionalProperties: false,
			type: 'object',
			defaultSnippets: [{ body: { id: '', label: '' } }],
			required: ['id', 'label'],
			properties: {
				id: {
					description: localize('positron.errorActionHandlerId', "Unique identifier of the coding agent, which the extension registers it with."),
					type: 'string',
				},
				label: {
					description: localize('positron.errorActionHandlerLabel', "Name of the coding agent, shown to users."),
					type: 'string',
				},
				supportsChatContinuation: {
					description: localize('positron.errorActionHandlerSupportsChatContinuation', "Whether the coding agent can continue the user's active chat, which adds an \"in current chat\" choice to Fix and Explain."),
					type: 'boolean',
					default: false,
				},
			},
		},
	},
	activationEventsGenerator: function* (contributions: readonly IErrorActionHandlerContribution[]) {
		for (const contribution of contributions) {
			yield getErrorActionHandlerActivationEvent(contribution.id);
		}
	},
});
