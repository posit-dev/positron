/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from '../../_test.setup';
import { evalTests, tags } from '../_helpers/eval-runner';
import { rNotebookAutomaticContext } from './r-notebook-automatic-context';
import { rNotebookEditCells } from './r-notebook-edit-cells';
import { rNotebookRunCells } from './r-notebook-run-cells';
import { rNotebookCreate } from './r-notebook-create';
import { pyNotebookGetCells } from './py-notebook-get-cells';

test.use({
	suiteId: __filename,
	// The eval runner signs in through the legacy provider dialog
	// (pages/positronAssistant.ts), which is no longer the default. Remove the
	// pin when that page object is ported to the new modal.
	extraSettings: { 'assistant.newProviderModal': false },
});

test.describe('Assistant Eval: Notebooks', { tag: [tags.ASSISTANT_EVAL, tags.POSITRON_NOTEBOOKS] }, () => {
	evalTests(test, [
		rNotebookAutomaticContext,
		rNotebookEditCells,
		rNotebookRunCells,
		rNotebookCreate,
		pyNotebookGetCells,
	], { category: 'notebooks' });
});
