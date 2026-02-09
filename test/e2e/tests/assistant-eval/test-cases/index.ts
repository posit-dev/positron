/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { EvalTestCase } from './types';

// Import all test cases
import { rForestedHallucination } from './r-forested-hallucination';
import { pythonTableSummary } from './python-table-summary';
import { pythonEditFile } from './python-edit-file';
import { pythonNoExecutionHallucination } from './python-no-execution-hallucination';

/**
 * All assistant evaluation test cases.
 *
 * To add a new test:
 * 1. Create a new file in this folder (e.g., my-new-test.ts)
 * 2. Export an EvalTestCase object
 * 3. Import and add it to this array
 */
export const testCases: EvalTestCase[] = [
	rForestedHallucination,
	pythonTableSummary,
	pythonEditFile,
	pythonNoExecutionHallucination,
];

// Re-export types for convenience
export { EvalTestCase, TestFixtures, EvaluationCriteria } from './types';
