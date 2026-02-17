/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, tags } from '../../_test.setup';
import { registerEvalTests } from '../_helpers/eval-runner';
import { rNotebookAutomaticContext } from './r-notebook-automatic-context';
import { rNotebookGetCells } from './r-notebook-get-cells';
import { rNotebookEditCells } from './r-notebook-edit-cells';
import { rNotebookRunCells } from './r-notebook-run-cells';
import { rNotebookCreate } from './r-notebook-create';
import { pyNotebookGetCells } from './py-notebook-get-cells';

const testCases = [
	rNotebookAutomaticContext,
	rNotebookGetCells,
	rNotebookEditCells,
	rNotebookRunCells,
	rNotebookCreate,
	pyNotebookGetCells,
];

test.use({ suiteId: __filename });

test.describe('Assistant Eval: Notebooks', { tag: [tags.ASSISTANT_EVAL, tags.POSITRON_NOTEBOOKS] }, () => {
	test.beforeAll(async ({ assistant }) => {
		await assistant.openPositronAssistantChat();
		await assistant.loginModelProvider('anthropic-api');
	});

	registerEvalTests(test, testCases, 'notebooks');

	test.afterAll(async ({ assistant }) => {
		await assistant.logoutModelProvider('anthropic-api');
	});
});
