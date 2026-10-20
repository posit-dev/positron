/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { equals } from '../../../../base/common/arrays.js';
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
		"The order of languages in the interpreter and language pickers and on the Welcome page. Languages not listed come after, alphabetically."
	),
	tags: ['interpreterSettings'],
};

const languageOrderNode: IConfigurationNode = {
	...positronConfigurationNodeBase,
	properties: { [LANGUAGE_ORDER_KEY]: languageOrderSchema },
};

const registry = Registry.as<IConfigurationRegistry>(Extensions.Configuration);
registry.registerConfiguration(languageOrderNode);

let installedLanguageIds: readonly string[] = [];

/** Replaces the allowed values: installed languages, then saved ones that aren't. Each in display order. */
export function updateLanguageOrderSchema(installed: readonly ILanguageOrderEntry[], notInstalled: readonly ILanguageOrderEntry[]): void {
	installedLanguageIds = installed.map(e => e.languageId);
	const entries = [...installed, ...notInstalled];
	const items = languageOrderSchema.items as IConfigurationPropertySchema;
	const ids = entries.map(e => e.languageId);
	const labels = entries.map(e => e.languageName);
	// A schema update re-renders the Settings editor, so skip it when a reorder changed nothing here.
	if (equals(items.enum, ids) && equals(languageOrderSchema.enumItemLabels, labels)) {
		return;
	}
	items.enum = ids;
	languageOrderSchema.enumItemLabels = labels;
	registry.notifyConfigurationSchemaUpdated(languageOrderNode);
}

/** Saved languages that aren't installed are allowed only so the scope that saved them validates. */
export function getInstalledLanguageIds(): readonly string[] {
	return installedLanguageIds;
}

export function getLanguageOrderSchema(): IConfigurationPropertySchema {
	return languageOrderSchema;
}
