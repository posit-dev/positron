/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ConfigurationScope, Extensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { positronConfigurationNodeBase } from '../../languageRuntime/common/languageRuntime.js';

export const OBJECT_EXPLORER_MAX_DEPTH_KEY = 'objectExplorer.maxDepth';

const MAX_DEPTH_DEFAULT = 10;
const MAX_DEPTH_MINIMUM = 1;
const MAX_DEPTH_MAXIMUM = 100;

/**
 * Gets the maximum depth the Object Explorer expands or searches.
 * @param configurationService The configuration service.
 * @returns The configured maximum depth, clamped to the allowed range.
 */
export function objectExplorerMaxDepth(configurationService: IConfigurationService): number {
	const value = configurationService.getValue<number>(OBJECT_EXPLORER_MAX_DEPTH_KEY);
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return MAX_DEPTH_DEFAULT;
	}
	return Math.min(MAX_DEPTH_MAXIMUM, Math.max(MAX_DEPTH_MINIMUM, Math.floor(value)));
}

Registry.as<IConfigurationRegistry>(Extensions.Configuration).registerConfiguration({
	...positronConfigurationNodeBase,
	scope: ConfigurationScope.MACHINE_OVERRIDABLE,
	properties: {
		[OBJECT_EXPLORER_MAX_DEPTH_KEY]: {
			type: 'integer',
			default: MAX_DEPTH_DEFAULT,
			minimum: MAX_DEPTH_MINIMUM,
			maximum: MAX_DEPTH_MAXIMUM,
			description: localize(
				'positron.objectExplorer.maxDepth',
				"Maximum nesting depth the Object Explorer will expand or search. Deeper levels are shown but cannot be opened."
			)
		}
	}
});
