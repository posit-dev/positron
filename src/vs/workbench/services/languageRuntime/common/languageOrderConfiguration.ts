/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { ConfigurationScope, Extensions, IConfigurationNode, IConfigurationPropertySchema, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { positronConfigurationNodeBase } from './languageRuntime.js';
import { ILanguageOrderEntry, LANGUAGE_ORDER_KEY } from './languageOrder.js';

const languageOrderSchema: IConfigurationPropertySchema = {
	type: 'array',
	items: { type: 'string', enum: [] },
	uniqueItems: true,
	default: [],
	// Explicit like the sibling settings; window scope allows per-workspace values.
	scope: ConfigurationScope.WINDOW,
	// Read by the Settings editor to label rows (array item labels aren't passed through).
	enumItemLabels: [],
	description: localize(
		'positron.interpreters.languageOrder',
		"The order of languages when picking an interpreter or language. Languages not listed come after, alphabetically."
	),
	tags: ['interpreterSettings'],
};

const languageOrderNode: IConfigurationNode = {
	...positronConfigurationNodeBase,
	properties: { [LANGUAGE_ORDER_KEY]: languageOrderSchema },
};

const registry = Registry.as<IConfigurationRegistry>(Extensions.Configuration);
registry.registerConfiguration(languageOrderNode);

/** Replaces the allowed values. `entries` must already be in display order. */
export function updateLanguageOrderSchema(entries: readonly ILanguageOrderEntry[]): void {
	(languageOrderSchema.items as IConfigurationPropertySchema).enum = entries.map(e => e.languageId);
	languageOrderSchema.enumItemLabels = entries.map(e => e.languageName);
	registry.notifyConfigurationSchemaUpdated(languageOrderNode);
}

export function getLanguageOrderSchema(): IConfigurationPropertySchema {
	return languageOrderSchema;
}
