/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { MultiLogger } from '../../infra/logger.js';
import { BaseMetric, MetricTargetType, MetricStatus, MetricContext, MetricResult } from './metric-base.js';
import { logMetric } from './api.js';

//-----------------------
// Feature-specific Types
//-----------------------

export type DataExplorerAction = 'filter' | 'sort' | 'to_code' | 'load_data';

export type DataExplorerMetric = BaseMetric & {
	feature_area: 'data_explorer';
	action: DataExplorerAction;
};

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

//-----------------------
// Record Functions
//-----------------------

/**
 * Parameters for data explorer record function (excluding duration_ms and feature_area)
 */
export interface DataExplorerRecordParams {
	action: DataExplorerAction;
	target_type: MetricTargetType;
	target_description?: string;
	context_json?: MetricContext | (() => Promise<MetricContext>);
	status?: MetricStatus;
}

/**
 * Records a Data Explorer Metric and returns both the operation result and duration
 *
 * @param operation The async operation to measure
 * @param params Metric parameters excluding duration_ms and feature_area
 * @param isElectronApp Whether running in Electron or Chromium
 * @param logger Logger for recording status and debugging information
 * @returns The result of the operation and the duration in milliseconds
 */
export async function recordDataExplorerMetric<T>(
	operation: () => Promise<T>,
	params: DataExplorerRecordParams,
	isElectronApp: boolean,
	logger: MultiLogger
): Promise<MetricResult<T>> {
	const startTime = Date.now();
	let operationStatus: MetricStatus = 'success';
	let result: T;
	let duration: number;

	try {
		result = await operation();
	} catch (error) {
		operationStatus = 'error';
		throw error; // Re-throw to maintain original behavior
	} finally {
		duration = Date.now() - startTime;

		// Resolve context_json if it's a function
		let resolvedContext: MetricContext = {};
		if (params.context_json) {
			if (typeof params.context_json === 'function') {
				try {
					resolvedContext = await params.context_json();
				} catch (error) {
					logger.log('Warning: Failed to resolve context_json function:', error);
					resolvedContext = {};
				}
			} else {
				resolvedContext = params.context_json;
			}
		}

		const metric: DataExplorerMetric = {
			feature_area: 'data_explorer',
			action: params.action,
			target_type: params.target_type,
			target_description: params.target_description,
			duration_ms: duration,
			status: params.status || operationStatus,
			context_json: resolvedContext
		};

		// Fire and forget - don't await to avoid affecting the operation result
		logMetric(metric, isElectronApp, logger).catch(error => {
			logger.log('Warning: Failed to log metric:', error);
		});
	}

	return { result: result!, duration_ms: duration! };
}

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
	if (!autoContext && !additionalContext) {
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
