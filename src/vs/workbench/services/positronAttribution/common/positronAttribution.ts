/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

/**
 * Attribution info for Positron licenses.
 */
export interface IPositronAttributionInfo {
	licensee?: string;
	issuer?: string;
}

export const IPositronAttributionService = createDecorator<IPositronAttributionService>('positronAttributionService');

/**
 * Service for retrieving Positron license attribution information.
 * This is used to display the licensee in the status bar and about dialog.
 */
export interface IPositronAttributionService {
	readonly _serviceBrand: undefined;

	/**
	 * Gets the attribution info for the current Positron instance.
	 * Returns undefined if no license attribution is available (e.g., desktop mode).
	 */
	getAttribution(): Promise<IPositronAttributionInfo | undefined>;
}
