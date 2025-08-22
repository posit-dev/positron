/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { MultiLogger } from '../../infra/logger.js';
import { BaseMetric, MetricTargetType, MetricStatus, MetricContext } from './metric-base.js';
import { logMetric } from './api.js';

//-----------------------
// Feature-specific Types
//-----------------------

export type NotebooksAction = 'run_cell' | 'open_notebook' | 'save_notebook';

export type NotebookMetric = BaseMetric & {
	feature_area: 'notebooks';
	action: NotebooksAction;
};

//-----------------------
// Factory Functions
//-----------------------

/**
 * Creates a notebook metric object with the feature_area preset
 *
 * @param params Parameters for the metric excluding feature_area and duration_ms
 * @returns A partially complete metric object ready for duration_ms to be added
 */
export function createNotebookMetric(params: Omit<NotebookMetric, 'feature_area' | 'duration_ms'>): Omit<NotebookMetric, 'duration_ms'> {
	return {
		feature_area: 'notebooks',
		...params
	};
}

//-----------------------
// Record Functions
//-----------------------

/**
 * Parameters for notebook record function (excluding duration_ms and feature_area)
 */
export interface NotebookRecordParams {
	action: NotebooksAction;
	target_type: MetricTargetType;
	target_description?: string;
	context_json?: MetricContext | (() => Promise<MetricContext>);
	status?: MetricStatus;
}

/**
 * Records a Notebook Metric
 *
 * @param operation The async operation to measure
 * @param params Metric parameters excluding duration_ms and feature_area
 * @param isElectronApp Whether running in Electron or Chromium
 * @param logger Logger for recording status and debugging information
 * @returns The result of the operation
 */
export async function recordNotebookMetric<T>(
	operation: () => Promise<T>,
	params: NotebookRecordParams,
	isElectronApp: boolean,
	logger: MultiLogger
): Promise<T> {
	const startTime = Date.now();
	let operationStatus: MetricStatus = 'success';
	let result: T;

	try {
		result = await operation();
	} catch (error) {
		operationStatus = 'error';
		throw error; // Re-throw to maintain original behavior
	} finally {
		const duration = Date.now() - startTime;

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

		const metric: NotebookMetric = {
			feature_area: 'notebooks',
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

	return result!;
}
