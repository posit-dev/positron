/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application, TestTags, Sessions, HotKeys, TestTeardown } from '../../infra';

/**
 * Settings fixture for configuring application settings.
 */
export interface Settings {
	set: (settings: Record<string, unknown>, options?: {
		reload?: boolean | 'web';
		waitMs?: number;
		waitForReady?: boolean;
		keepOpen?: boolean;
	}) => Promise<void>;
}

/**
 * Playwright fixtures passed to test case run functions.
 * Same pattern as other Playwright tests - no custom abstraction.
 */
export interface TestFixtures {
	app: Application;
	sessions: Sessions;
	hotKeys: HotKeys;
	cleanup: TestTeardown;
	settings: Settings;
}

/**
 * Evaluation criteria for grading LLM responses.
 */
export interface EvaluationCriteria {
	/** Essential criteria - ALL must be met for Complete grade */
	essential: string[];

	/** Additional criteria - meeting these improves the grade */
	additional?: string[];

	/** Automatic fail conditions - ANY of these results in Incomplete */
	failIf?: string[];
}

/**
 * Result of LLM evaluation.
 */
export interface EvaluationResult {
	/** Grade: Complete, Partial, or Incomplete */
	grade: 'C' | 'P' | 'I';

	/** Explanation of the grade */
	explanation: string;
}

/**
 * A single evaluation test case.
 * Uses the same fixtures pattern as other Playwright tests.
 */
export interface EvalTestCase {
	/** Unique identifier for the test */
	id: string;

	/** Human-readable description */
	description: string;

	/** The prompt/question sent to the assistant (for catalog visibility) */
	prompt: string;

	/** Chat mode used for the test */
	mode: 'Ask' | 'Edit' | 'Agent';

	/** Tags for filtering - uses standard TestTags from the test infrastructure */
	tags?: TestTags[];

	/**
	 * The test function - reads like a test from top to bottom.
	 * Uses standard Playwright fixtures, just like other tests.
	 * Each test is responsible for starting its own sessions if needed.
	 */
	run: (fixtures: TestFixtures) => Promise<string>;

	/** Criteria for evaluating the LLM response */
	evaluationCriteria: EvaluationCriteria;
}
