/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from '../../_test.setup';
import { EVAL_TAG, defineEvalTests } from '../_helpers/test-runner';
import { pythonEditFile } from './python-edit-file';
import { pythonTableSummary } from './python-table-summary';

const testCases = [
	pythonEditFile,
	pythonTableSummary,
];

test.use({ suiteId: __filename });

test.describe('Assistant Eval: Tools', { tag: [EVAL_TAG] }, () => {
	defineEvalTests(test, testCases);
});
