"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const _test_setup_1 = require("../../_test.setup");
const eval_runner_1 = require("../_helpers/eval-runner");
const python_edit_file_1 = require("./python-edit-file");
const python_table_summary_1 = require("./python-table-summary");
_test_setup_1.test.use({ suiteId: __filename });
_test_setup_1.test.describe('Assistant Eval: Tools', { tag: [eval_runner_1.tags.ASSISTANT_EVAL] }, () => {
    (0, eval_runner_1.evalTests)(_test_setup_1.test, [
        python_edit_file_1.pythonEditFile,
        python_table_summary_1.pythonTableSummary,
    ], { category: 'tools' });
});
//# sourceMappingURL=eval-tools.test.js.map