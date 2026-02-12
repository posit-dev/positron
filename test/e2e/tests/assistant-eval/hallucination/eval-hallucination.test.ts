/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from '../../_test.setup';
import { EVAL_TAG, defineEvalTests } from '../_helpers/test-runner';
import { rForestedHallucination } from './r-forested-hallucination';
import { pythonNoExecutionHallucination } from './python-no-execution-hallucination';

test.use({ suiteId: __filename });

test.describe('Assistant Eval: Hallucination', { tag: [EVAL_TAG] }, () => {
	defineEvalTests(test, [
		rForestedHallucination,
		pythonNoExecutionHallucination,
	]);
});
