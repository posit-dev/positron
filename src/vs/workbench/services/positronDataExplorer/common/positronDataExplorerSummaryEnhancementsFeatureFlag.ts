/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';

// The key for the feature flag that controls the
// data explorer summary panel enhancements feature work.
// This key is not registered in the configuration registry
// because we do not want to expose this setting in the settings UI.
export const USE_DATA_EXPLORER_SUMMARY_PANEL_ENHANCEMENTS_KEY =
	'dataExplorer.summaryPanelEnhancements';

/**
 * Retrieves the value of the configuration setting that determines whether to enable
 * the data explorer summary panel enhancements feature.
 * @param configurationService The configuration service
 * @returns Whether to enablet the summary panel enhancements feature
 */
export function summaryPanelEnhancementsFeatureEnabled(
	configurationService: IConfigurationService
) {
	return Boolean(
		configurationService.getValue(USE_DATA_EXPLORER_SUMMARY_PANEL_ENHANCEMENTS_KEY)
	);
}
