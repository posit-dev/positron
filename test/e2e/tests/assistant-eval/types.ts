/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application, TestTags, Sessions, HotKeys, TestTeardown } from '../../infra';
import { Settings } from '../../fixtures/test-setup/settings.fixtures';
import { EnterChatMessageResult } from '../../pages/positronAssistant';

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
	/** Required criteria - ALL must be met for Complete grade */
	required: string[];

	/** Optional criteria - meeting these improves the grade */
	optional?: string[];

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
 * Result returned by an eval test case's run function.
 */
export interface RunResult {
	/** The response text from the assistant */
	response: string;
	/** Timing information for the LLM response (excludes setup/cleanup) */
	timing: EnterChatMessageResult;
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

	/** Primary language used in the test (for metrics) */
	language?: 'R' | 'Python';

	/** Tags for filtering - uses standard TestTags from the test infrastructure */
	tags?: TestTags[];

	/**
	 * The test function - reads like a test from top to bottom.
	 * Uses standard Playwright fixtures, just like other tests.
	 * Each test is responsible for starting its own sessions if needed.
	 *
	 * Returns a RunResult containing the response text and timing information.
	 * Use `assistant.sendChatMessageAndWait()` to get accurate timing that
	 * excludes setup/cleanup and button interaction overhead.
	 */
	run: (fixtures: TestFixtures) => Promise<RunResult>;

	/** Criteria for evaluating the LLM response */
	evaluationCriteria: EvaluationCriteria;
}
