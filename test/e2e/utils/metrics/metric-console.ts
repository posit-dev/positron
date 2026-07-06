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

export type ConsoleAction = 'execute_code';

export type ConsoleMetric = BaseMetric & {
	feature_area: 'console';
	action: ConsoleAction;
};

/**
 * Declared variants for console `execute_code` — a named sub-scenario that
 * shares one (action, target_type) but exercises a different code path. This
 * union is the contract: the e2e-test-insights dashboard groups the Duration
 * Distribution box plot by `variant`, and a typo here won't compile, so the
 * dashboard can trust the value without an allowlist. Add a member only for a
 * genuinely new, deliberately-benchmarked scenario; keep values short, stable,
 * and snake_case.
 */
export type ConsoleExecuteVariant = 'simple_expression' | 'scrollback_trim';

//-----------------------
// Create Feature Factory
//-----------------------

const { recordMetric: recordConsoleMetric } = createFeatureMetricFactory<ConsoleAction>('console');

//-----------------------
// Factory Functions
//-----------------------

export function createConsoleMetric(params: Omit<ConsoleMetric, 'feature_area' | 'duration_ms'>): Omit<ConsoleMetric, 'duration_ms'> {
	return {
		feature_area: 'console',
		...params
	};
}

export { recordConsoleMetric };

//-----------------------
// Convenience Shortcuts
//-----------------------

export interface ConsoleShortcutOptions {
	description?: string;
	language?: string;
	/** Declared sub-scenario for grouping in the dashboard. Typed so a typo won't compile. */
	variant?: ConsoleExecuteVariant;
	additionalContext?: MetricContext | (() => Promise<MetricContext>);
}

/**
 * Shortcut for recording console code execution time from "user submits code"
 * to "console reports ready." Use via the fixture as `metric.console.executeCode(...)`.
 */
export async function recordExecuteCode<T>(
	operation: () => Promise<T>,
	targetType: MetricTargetType,
	isElectronApp: boolean,
	logger: MultiLogger,
	options: ConsoleShortcutOptions = {}
): Promise<MetricResult<T>> {
	const { description, language, variant, additionalContext } = options;

	const context_json = language !== undefined || variant !== undefined || additionalContext ? async (): Promise<MetricContext> => {
		const base: MetricContext = {};
		if (language !== undefined) { base.language = language; }
		if (variant !== undefined) { base.variant = variant; }

		if (!additionalContext) {
			return base;
		}

		const extra = typeof additionalContext === 'function' ? await additionalContext() : additionalContext;
		return { ...base, ...extra };
	} : undefined;

	return recordConsoleMetric(operation, {
		action: 'execute_code',
		target_type: targetType,
		target_description: description || `Execute code: ${targetType}`,
		variant,
		context_json,
	}, isElectronApp, logger);
}
