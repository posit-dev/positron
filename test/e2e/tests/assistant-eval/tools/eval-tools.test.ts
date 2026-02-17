/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../../_test.setup';
import { registerEvalTests } from '../_helpers/eval-runner';
import { pythonEditFile } from './python-edit-file';
import { pythonTableSummary } from './python-table-summary';

const testCases = [
	pythonEditFile,
	pythonTableSummary,
];

test.use({ suiteId: __filename });

test.describe('Assistant Eval: Tools', { tag: [tags.ASSISTANT_EVAL] }, () => {
	test.beforeAll(async ({ assistant }) => {
		await assistant.openPositronAssistantChat();
		await assistant.loginModelProvider('anthropic-api');
	});

	registerEvalTests(test, testCases, 'tools');

	test.afterAll(async ({ assistant }) => {
		await assistant.logoutModelProvider('anthropic-api');
	});
});
