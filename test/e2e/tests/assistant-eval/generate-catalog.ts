/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Standalone script to generate the LLM_EVAL_TEST_CATALOG.html file
 * without running the full test suite.
 *
 * Usage (from repo root):
 *   node test/e2e/out/tests/assistant-eval/generate-catalog.js
 *
 * Or use the shell wrapper:
 *   ./test/e2e/tests/assistant-eval/generate-catalog.sh
 *
 * Note: Requires e2e tests to be compiled first (npm run build-start)
 */

import { testCases } from './test-cases';
import { generateCatalog } from './evaluator/eval-results';

console.log('Generating eval catalog...\n');
generateCatalog(testCases);
console.log('Done!');
