/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from '../../_test.setup';
import { EVAL_TAG, defineEvalTests } from '../_helpers/test-runner';
import { rNotebookAutomaticContext } from './r-notebook-automatic-context';
import { rNotebookGetCells } from './r-notebook-get-cells';
import { rNotebookEditCells } from './r-notebook-edit-cells';
import { rNotebookRunCells } from './r-notebook-run-cells';
import { rNotebookCreate } from './r-notebook-create';

test.use({ suiteId: __filename });

test.describe('Assistant Eval: Notebooks', { tag: [EVAL_TAG] }, () => {
	defineEvalTests(test, [
		rNotebookAutomaticContext,
		rNotebookGetCells,
		rNotebookEditCells,
		rNotebookRunCells,
		rNotebookCreate,
	]);
});
