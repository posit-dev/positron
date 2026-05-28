/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { filter } from '../../../../base/common/objects.js';
import { hasKey } from '../../../../base/common/types.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { SnapshotContext } from '../../../services/workingCopy/common/fileWorkingCopy.js';
import { ICellOutput, IOutputDto, NotebookSetting, TransientOptions } from './notebookCommon.js';
import { INotebookSerializer } from './notebookService.js';

/**
 * Create a snapshot of notebook cell outputs.
 *
 * This differs from upstream in that if cell execution counts are set as transient,
 * it also excludes execution counts from the cell outputs snapshot.
 */
export function snapshotNotebookCellOutputs(
	outputs: ICellOutput[],
	transientOptions: TransientOptions,
): IOutputDto[] {
	// Wrap in a try/catch since erroring here blocks saving which is critical.
	try {
		// If outputs are transient, don't snapshot them at all (matches upstream).
		if (transientOptions.transientOutputs) {
			return [];
		}
		// If cell execution counts are not transient, keep all outputs (matches upstream).
		if (!transientOptions.transientCellMetadata.execution_count) {
			return outputs;
		}
		// Cell exectuion counts are transient, remove output execution counts as well.
		return outputs.map(output => {
			// If the output doesn't have metadata or execution counts, nothing to do.
			if (!output.metadata || !hasKey(output.metadata, { executionCount: true })) {
				return output;
			}
			// Remove execution counts.
			const metadata = filter(output.metadata, key => key !== 'executionCount');
			return {
				// NOTE: Spreading `output` does not work, `asDto()` is required.
				...output.asDto(),
				metadata: Object.keys(metadata).length > 0 ? metadata : undefined
			};
		});
	} catch (error) {
		console.error(
			`Error snapshotting notebook cell outputs with transient execution counts: ` +
			`${error instanceof Error ? error.message : JSON.stringify(error)}`
		);
		return outputs;
	}
}

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
