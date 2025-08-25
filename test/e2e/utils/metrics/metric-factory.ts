/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { MultiLogger } from '../../infra/logger.js';
import { BaseMetric, MetricTargetType, MetricStatus, MetricContext, MetricResult } from './metric-base.js';
import { logMetric } from './api.js';

//-----------------------
// Generic Metric Factory
//-----------------------

/**
 * Generic metric interface that all feature metrics extend
 */
export interface FeatureMetric<TAction extends string> extends BaseMetric {
	feature_area: string;
	action: TAction;
}

/**
 * Parameters for recording any metric (excluding duration_ms and feature_area)
 */
export interface RecordMetricParams<TAction extends string> {
	action: TAction;
	target_type: MetricTargetType;
	target_description?: string;
	context_json?: MetricContext | (() => Promise<MetricContext>);
	status?: MetricStatus;
}

/**
 * Creates a generic metric recorder for a specific feature area
 *
 * @param featureArea The name of the feature area (e.g., 'data_explorer', 'notebooks')
 * @returns A function that records metrics for this feature area
 */
export function createMetricRecorder<TAction extends string>(featureArea: string) {
	/**
	 * Records a metric for the feature area
	 *
	 * @param operation The async operation to measure
	 * @param params Metric parameters excluding duration_ms and feature_area
	 * @param isElectronApp Whether running in Electron or Chromium
	 * @param logger Logger for recording status and debugging information
	 * @returns The result of the operation and the duration in milliseconds
	 */
	return async function recordMetric<T>(
		operation: () => Promise<T>,
		params: RecordMetricParams<TAction>,
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

			const metric: FeatureMetric<TAction> = {
				feature_area: featureArea,
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
	};
}

/**
 * Creates a factory for a specific feature area that provides both the record function
 * and helper utilities for building shortcuts
 */
export function createFeatureMetricFactory<TAction extends string>(featureArea: string) {
	const recordMetric = createMetricRecorder<TAction>(featureArea);

	/**
	 * Creates a shortcut function for a specific action
	 */
	function createShortcut<TShortcutOptions = {}>(
		action: TAction,
		defaultDescription?: string,
		contextBuilder?: (options?: TShortcutOptions) => MetricContext | (() => Promise<MetricContext>) | undefined
	) {
		return async function <T>(
			operation: () => Promise<T>,
			targetType: MetricTargetType,
			isElectronApp: boolean,
			logger: MultiLogger,
			options?: TShortcutOptions & { description?: string; additionalContext?: MetricContext | (() => Promise<MetricContext>) }
		): Promise<MetricResult<T>> {
			const description = options?.description || defaultDescription || `${action} ${targetType}`;

			let context_json: MetricContext | (() => Promise<MetricContext>) | undefined;

			// Build context from contextBuilder if provided
			if (contextBuilder) {
				context_json = contextBuilder(options);
			}

			// Merge with additional context if provided
			if (options?.additionalContext) {
				if (context_json) {
					// If both exist, we need to merge them
					const baseContext = context_json;
					context_json = async () => {
						let base: MetricContext = {};
						if (typeof baseContext === 'function') {
							base = await baseContext();
						} else {
							base = baseContext;
						}

						let additional: MetricContext = {};
						if (typeof options.additionalContext === 'function') {
							additional = await options.additionalContext();
						} else if (options.additionalContext) {
							additional = options.additionalContext;
						}

						return { ...base, ...additional };
					};
				} else {
					context_json = options.additionalContext;
				}
			}

			return recordMetric(operation, {
				action,
				target_type: targetType,
				target_description: description,
				context_json
			}, isElectronApp, logger);
		};
	}

	return {
		recordMetric,
		createShortcut
	};
}
