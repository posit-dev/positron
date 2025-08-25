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

export type NotebooksAction = 'run_cell' | 'open_notebook' | 'save_notebook';

export type NotebookMetric = BaseMetric & {
	feature_area: 'notebooks';
	action: NotebooksAction;
};

//-----------------------
// Create Feature Factory
//-----------------------

const { recordMetric: recordNotebookMetric } = createFeatureMetricFactory<NotebooksAction>('notebooks');

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

// Export the main record function
export { recordNotebookMetric };

//-----------------------
// Convenience Shortcuts
//-----------------------

/**
 * Options for notebook shortcut metric functions
 */
export interface NotebookShortcutOptions {
	description?: string;
	additionalContext?: MetricContext | (() => Promise<MetricContext>);
}

/**
 * Shortcut for recording notebook cell execution with language context
 */
export async function recordRunCell<T>(
	operation: () => Promise<T>,
	targetType: MetricTargetType,
	isElectronApp: boolean,
	logger: MultiLogger,
	language?: string,
	options: NotebookShortcutOptions = {}
): Promise<MetricResult<T>> {
	const { description, additionalContext } = options;

	// Build context with language if provided
	let context_json: MetricContext | (() => Promise<MetricContext>) | undefined;

	if (language || additionalContext) {
		context_json = async () => {
			let baseContext: MetricContext = {};

			if (language) {
				baseContext.language = language;
			}

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

	return recordNotebookMetric(operation, {
		action: 'run_cell',
		target_type: targetType,
		target_description: description || `Running ${language || targetType} cell`,
		context_json
	}, isElectronApp, logger);
}
