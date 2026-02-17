/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from '../../_test.setup';
import { evalTests, tags } from '../_helpers/test-template';
import { rNotebookAutomaticContext } from './r-notebook-automatic-context';
import { rNotebookGetCells } from './r-notebook-get-cells';
import { rNotebookEditCells } from './r-notebook-edit-cells';
import { rNotebookRunCells } from './r-notebook-run-cells';
import { rNotebookCreate } from './r-notebook-create';

test.use({ suiteId: __filename });

test.describe('Assistant Eval: Notebooks', { tag: [tags.ASSISTANT_EVAL, tags.POSITRON_NOTEBOOKS] }, () => {
	evalTests(test, [
		rNotebookAutomaticContext,
		rNotebookGetCells,
		rNotebookEditCells,
		rNotebookRunCells,
		rNotebookCreate,
	]);
});
