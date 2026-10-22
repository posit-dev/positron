/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';

export const LANGUAGE_ORDER_KEY = 'interpreters.languageOrder';

export interface ILanguageOrderEntry {
	readonly languageId: string;
	readonly languageName: string;
}

/** Languages in `order` first, in that order; the rest after, by name. */
export function compareLanguages(a: ILanguageOrderEntry, b: ILanguageOrderEntry, order: readonly string[]): number {
	const aIndex = order.indexOf(a.languageId);
	const bIndex = order.indexOf(b.languageId);
	if (aIndex !== bIndex) {
		if (aIndex === -1) {
			return 1;
		}
		if (bIndex === -1) {
			return -1;
		}
		return aIndex - bIndex;
	}
	return a.languageName.localeCompare(b.languageName) || a.languageId.localeCompare(b.languageId);
}

/** The saved order, cleaned of hand-edited junk. Read it each time a list is built. */
export function getLanguageOrder(configurationService: IConfigurationService): readonly string[] {
	const value = configurationService.getValue<unknown>(LANGUAGE_ORDER_KEY);
	if (!Array.isArray(value)) {
		return [];
	}
	return [...new Set(value.filter((id): id is string => typeof id === 'string'))];
}
