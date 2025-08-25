/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { MultiLogger } from '../../infra/logger.js';
import { BaseMetric, MetricTargetType, MetricContext, MetricResult } from './metric-base.js';
import { createFeatureMetricFactory } from './metric-factory.js';

//-----------------------
// Feature-specific Types
//-----------------------

export type DataExplorerAction = 'filter' | 'sort' | 'to_code' | 'load_data';

export type DataExplorerMetric = BaseMetric & {
	feature_area: 'data_explorer';
	action: DataExplorerAction;
};

//-----------------------
// Create Feature Factory
//-----------------------

const { recordMetric: recordDataExplorerMetric } = createFeatureMetricFactory<DataExplorerAction>('data_explorer');

//-----------------------
// Factory Functions
//-----------------------

/**
 * Creates a data explorer metric object with the feature_area preset
 *
 * @param params Parameters for the metric excluding feature_area and duration_ms
 * @returns A partially complete metric object ready for duration_ms to be added
 */
export function createDataExplorerMetric(params: Omit<DataExplorerMetric, 'feature_area' | 'duration_ms'>): Omit<DataExplorerMetric, 'duration_ms'> {
	return {
		feature_area: 'data_explorer',
		...params
	};
}

// Export the main record function
export { recordDataExplorerMetric };

//-----------------------
// Convenience Shortcuts
//-----------------------

/**
 * Auto-context collector for data explorer operations
 * For example, when using this metric we automatically
 * collect row/col count for the metrics
 */
export interface DataExplorerAutoContext {
	getRowCount: () => Promise<number>;
	getColumnCount: () => Promise<number>;
}

/**
 * Options for data explorer shortcut metric functions
 */
export interface DataExplorerShortcutOptions {
	description?: string;
	additionalContext?: MetricContext | (() => Promise<MetricContext>);
}

/**
 * Helper function to build context for data explorer operations
 */
function buildDataExplorerContext(
	autoContext?: DataExplorerAutoContext,
	additionalContext?: MetricContext | (() => Promise<MetricContext>),
	extraBaseContext: MetricContext = {}
): (() => Promise<MetricContext>) | undefined {
	if (!autoContext && !additionalContext && Object.keys(extraBaseContext).length === 0) {
		return undefined;
	}

	return async () => {
		let baseContext: MetricContext = { ...extraBaseContext };

		// Add auto context if available
		if (autoContext) {
			baseContext = {
				...baseContext,
				data_rows: await autoContext.getRowCount(),
				data_cols: await autoContext.getColumnCount()
			};
		}

		// Add additional context if available
		if (additionalContext) {
			if (typeof additionalContext === 'function') {
				const additional = await additionalContext();
				return { ...baseContext, ...additional };
			} else {
				return { ...baseContext, ...additionalContext };
			}
		}

		return baseContext;
	};
}

/**
 * Shortcut for recording data file load operations with auto-context
 */
export async function recordDataFileLoad<T>(
	operation: () => Promise<T>,
	targetType: MetricTargetType,
	isElectronApp: boolean,
	logger: MultiLogger,
	autoContext?: DataExplorerAutoContext,
	options: DataExplorerShortcutOptions = {}
): Promise<MetricResult<T>> {
	const { description, additionalContext } = options;

	return recordDataExplorerMetric(operation, {
		action: 'load_data',
		target_type: targetType,
		target_description: description || `Loading ${targetType} file`,
		context_json: buildDataExplorerContext(autoContext, additionalContext)
	}, isElectronApp, logger);
}

/**
 * Shortcut for recording data explorer filter operations with auto-context
 */
export async function recordDataFilter<T>(
	operation: () => Promise<T>,
	targetType: MetricTargetType,
	isElectronApp: boolean,
	logger: MultiLogger,
	autoContext?: DataExplorerAutoContext,
	options: DataExplorerShortcutOptions = {}
): Promise<MetricResult<T>> {
	const { description, additionalContext } = options;

	return recordDataExplorerMetric(operation, {
		action: 'filter',
		target_type: targetType,
		target_description: description || `Filtering ${targetType} data`,
		context_json: buildDataExplorerContext(autoContext, additionalContext, { filter_applied: true })
	}, isElectronApp, logger);
}

/**
 * Shortcut for recording data explorer sort operations with auto-context
 */
export async function recordDataSort<T>(
	operation: () => Promise<T>,
	targetType: MetricTargetType,
	isElectronApp: boolean,
	logger: MultiLogger,
	autoContext?: DataExplorerAutoContext,
	options: DataExplorerShortcutOptions = {}
): Promise<MetricResult<T>> {
	const { description, additionalContext } = options;

	return recordDataExplorerMetric(operation, {
		action: 'sort',
		target_type: targetType,
		target_description: description || `Sorting ${targetType} data`,
		context_json: buildDataExplorerContext(autoContext, additionalContext, { sort_applied: true })
	}, isElectronApp, logger);
}

/**
 * Shortcut for recording to-code operations with auto-context
 */
export async function recordToCode<T>(
	operation: () => Promise<T>,
	targetType: MetricTargetType,
	isElectronApp: boolean,
	logger: MultiLogger,
	autoContext?: DataExplorerAutoContext,
	options: DataExplorerShortcutOptions = {}
): Promise<MetricResult<T>> {
	const { description, additionalContext } = options;

	return recordDataExplorerMetric(operation, {
		action: 'to_code',
		target_type: targetType,
		target_description: description || `Converting ${targetType} data to code`,
		context_json: buildDataExplorerContext(autoContext, additionalContext)
	}, isElectronApp, logger);
}
