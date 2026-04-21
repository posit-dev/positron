/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { MultiLogger } from '../../infra/logger.js';
import { BaseMetric, MetricTargetType, MetricContext, MetricResult } from './metric-base.js';
import { createFeatureMetricFactory } from './metric-factory.js';

//-----------------------
// Feature-specific Types
//-----------------------

export type SessionsAction = 'start';

export type SessionMetric = BaseMetric & {
	feature_area: 'sessions';
	action: SessionsAction;
};

//-----------------------
// Create Feature Factory
//-----------------------

const { recordMetric: recordSessionMetric } = createFeatureMetricFactory<SessionsAction>('sessions');

//-----------------------
// Factory Functions
//-----------------------

export function createSessionMetric(params: Omit<SessionMetric, 'feature_area' | 'duration_ms'>): Omit<SessionMetric, 'duration_ms'> {
	return {
		feature_area: 'sessions',
		...params
	};
}

export { recordSessionMetric };

//-----------------------
// Convenience Shortcuts
//-----------------------

/**
 * Options for the `start` session shortcut.
 *
 * `sessionMode` is required so every emitted metric is bucket-able by console vs notebook.
 * `cold` is a leaky label - it records whether this test observed no prior session of this
 * interpreter in the current window, not true kernel-level coldness.
 */
export interface SessionStartShortcutOptions {
	sessionMode: 'console' | 'notebook';
	description?: string;
	runtimeVersion?: string;
	interpreterKind?: 'system' | 'venv' | 'conda' | 'uv' | 'renv' | 'other';
	cold?: boolean;
	language?: string;
	additionalContext?: MetricContext | (() => Promise<MetricContext>);
}

/**
 * Shortcut for recording interpreter startup time from "user picks interpreter"
 * to "session reports idle." Use via the fixture as `metric.sessions.start(...)`.
 */
export async function recordSessionStart<T>(
	operation: () => Promise<T>,
	targetType: MetricTargetType,
	isElectronApp: boolean,
	logger: MultiLogger,
	options: SessionStartShortcutOptions
): Promise<MetricResult<T>> {
	const { sessionMode, description, runtimeVersion, interpreterKind, cold, language, additionalContext } = options;

	const context_json = async (): Promise<MetricContext> => {
		const base: MetricContext = { session_mode: sessionMode };
		if (runtimeVersion !== undefined) { base.runtime_version = runtimeVersion; }
		if (interpreterKind !== undefined) { base.interpreter_kind = interpreterKind; }
		if (cold !== undefined) { base.cold = cold; }
		if (language !== undefined) { base.language = language; }

		if (!additionalContext) {
			return base;
		}

		const extra = typeof additionalContext === 'function' ? await additionalContext() : additionalContext;
		return { ...base, ...extra };
	};

	return recordSessionMetric(operation, {
		action: 'start',
		target_type: targetType,
		target_description: description || `Start ${sessionMode} session (${targetType})`,
		context_json,
	}, isElectronApp, logger);
}
