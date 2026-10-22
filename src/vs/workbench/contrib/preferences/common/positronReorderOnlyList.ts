/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Extensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { createValidator } from '../../../services/preferences/common/preferencesValidation.js';
import { LANGUAGE_ORDER_KEY } from '../../../services/languageRuntime/common/languageOrder.js';
import { getLanguageOrderChoices, ILanguageOrderChoices } from '../../../services/languageRuntime/common/languageOrderConfiguration.js';

// List settings the user only reorders, each with its current allowed values, labels and defaults.
const REORDER_ONLY_SETTINGS = new Map<string, () => ILanguageOrderChoices>([[LANGUAGE_ORDER_KEY, getLanguageOrderChoices]]);

export function isReorderOnlyList(key: string): boolean {
	return REORDER_ONLY_SETTINGS.has(key);
}

/** Read live rather than from the Settings editor's setting, which can predate a schema update. */
export function reorderListChoices(key: string): ILanguageOrderChoices {
	return REORDER_ONLY_SETTINGS.get(key)?.() ?? { allowed: [], labels: [], defaults: [] };
}

/** The saved value's validation error, checked against the live schema like {@link reorderListChoices}. */
export function reorderListError(key: string, value: unknown): string | null {
	const schema = Registry.as<IConfigurationRegistry>(Extensions.Configuration).getConfigurationProperties()[key];
	return (schema && createValidator(schema)(value)) || null;
}

/**
 * The rows to show: the saved strings, each once, then any of `defaults` missing from them (so a
 * newly installed language shows up). Each is labeled from `labels`, or else by itself.
 */
export function reorderRows({ allowed, labels, defaults }: ILanguageOrderChoices, value: readonly unknown[]): { value: string; label: string }[] {
	const saved = [...new Set(value.filter((v): v is string => typeof v === 'string'))];
	const missing = defaults.filter(v => !saved.includes(v));
	return [...saved, ...missing].map(v => ({
		value: v,
		label: labels[allowed.indexOf(v)] ?? v,
	}));
}
