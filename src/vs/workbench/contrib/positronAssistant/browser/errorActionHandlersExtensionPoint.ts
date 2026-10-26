/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { IExtensionDescription } from '../../../../platform/extensions/common/extensions.js';
import { ExtensionsRegistry } from '../../../services/extensions/common/extensionsRegistry.js';

/** An error action handler an extension declares in its package.json. */
export interface IErrorActionHandlerContribution {
	/** The id the extension registers the handler with. */
	readonly id: string;
	/** The handler's name, shown until the extension registers it. */
	readonly label: string;
}

/** The activation event that starts the extension that contributes a handler. */
export function getErrorActionHandlerActivationEvent(id: string): string {
	return `onErrorActionHandler:${id}`;
}

/**
 * The `errorActionHandlers` contribution point. Declaring a handler names it
 * before its extension activates, and lets Positron activate the extension
 * when the handler is asked to take an error before it has registered.
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
			},
		},
	},
	activationEventsGenerator: function* (contributions: readonly IErrorActionHandlerContribution[]) {
		for (const contribution of contributions) {
			yield getErrorActionHandlerActivationEvent(contribution.id);
		}
	},
});

/** The well-formed handlers an extension contributes. */
export function getErrorActionHandlerContributions(extension: IExtensionDescription): IErrorActionHandlerContribution[] {
	const contributions = (extension.contributes as { errorActionHandlers?: unknown } | undefined)?.errorActionHandlers;
	if (!Array.isArray(contributions)) {
		return [];
	}
	return contributions.filter((contribution): contribution is IErrorActionHandlerContribution =>
		typeof contribution?.id === 'string' && typeof contribution?.label === 'string');
}
