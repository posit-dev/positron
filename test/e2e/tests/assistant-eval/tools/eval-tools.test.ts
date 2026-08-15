/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test } from '../../_test.setup';
import { evalTests, tags } from '../_helpers/eval-runner';
import { pythonEditFile } from './python-edit-file';
import { pythonTableSummary } from './python-table-summary';

test.use({
	suiteId: __filename,
	// The eval runner signs in through the legacy provider dialog
	// (pages/positronAssistant.ts), which is no longer the default. Remove the
	// pin when that page object is ported to the new modal.
	extraSettings: { 'assistant.newProviderModal': false },
});

test.describe('Assistant Eval: Tools', { tag: [tags.ASSISTANT_EVAL] }, () => {
	evalTests(test, [
		pythonEditFile,
		pythonTableSummary,
	], { category: 'tools' });
});
