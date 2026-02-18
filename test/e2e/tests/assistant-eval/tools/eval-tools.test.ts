/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from '../../_test.setup';
import { tags, evalTests } from '../_helpers/test-template';
import { pythonEditFile } from './python-edit-file';
import { pythonTableSummary } from './python-table-summary';

test.use({ suiteId: __filename });

test.describe('Assistant Eval: Tools', { tag: [tags.ASSISTANT_EVAL] }, () => {
	evalTests(test, [
		pythonEditFile,
		pythonTableSummary,
	]);
});
