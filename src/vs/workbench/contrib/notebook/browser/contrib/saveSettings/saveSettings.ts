/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { SnapshotContext } from '../../../../../services/workingCopy/common/fileWorkingCopy.js';
import { NotebookSetting } from '../../../common/notebookCommon.js';
import { INotebookSerializer } from '../../../common/notebookService.js';

/**
 * Resolve notebook serializer options based on user settings.
 * For example, users may disable saving execution counts for
 * version control friendly notebooks.
 */
export function resolveNotebookSerializerOptions(
	options: INotebookSerializer['options'],
	context: SnapshotContext,
	configurationService: IConfigurationService,
): INotebookSerializer['options'] {
	// Only apply on save. When a snapshot is created for backup
	// it should keep the original serializer settings.
	if (context !== SnapshotContext.Save) {
		return options;
	}

	// When a transient options are enabled, the corresponding data is removed
	// before being sent to the serializer.
	return {
		...options,
		transientOutputs: !shouldSaveNotebookOutputs(configurationService),
		transientCellMetadata: {
			execution_count: !shouldCleanNotebookExecutionCountsOnSave(configurationService),
		},
	};
}

/**
 * Determine whether notebook outputs should be saved to file, based on the user's settings.
 */
function shouldSaveNotebookOutputs(configurationService: IConfigurationService) {
	return configurationService.getValue<boolean>(NotebookSetting.saveOutputs);
}

/**
 * Determine whether notebook execution counts should be saved to file, based on the user's settings.
 */
function shouldCleanNotebookExecutionCountsOnSave(configurationService: IConfigurationService) {
	return configurationService.getValue<boolean>(NotebookSetting.saveExecutionCounts);
}
