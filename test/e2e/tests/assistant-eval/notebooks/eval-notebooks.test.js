"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const _test_setup_1 = require("../../_test.setup");
const eval_runner_1 = require("../_helpers/eval-runner");
const r_notebook_automatic_context_1 = require("./r-notebook-automatic-context");
const r_notebook_edit_cells_1 = require("./r-notebook-edit-cells");
const r_notebook_run_cells_1 = require("./r-notebook-run-cells");
const r_notebook_create_1 = require("./r-notebook-create");
const py_notebook_get_cells_1 = require("./py-notebook-get-cells");
_test_setup_1.test.use({ suiteId: __filename });
_test_setup_1.test.describe('Assistant Eval: Notebooks', { tag: [eval_runner_1.tags.ASSISTANT_EVAL, eval_runner_1.tags.POSITRON_NOTEBOOKS] }, () => {
    (0, eval_runner_1.evalTests)(_test_setup_1.test, [
        r_notebook_automatic_context_1.rNotebookAutomaticContext,
        r_notebook_edit_cells_1.rNotebookEditCells,
        r_notebook_run_cells_1.rNotebookRunCells,
        r_notebook_create_1.rNotebookCreate,
        py_notebook_get_cells_1.pyNotebookGetCells,
    ], { category: 'notebooks' });
});
//# sourceMappingURL=eval-notebooks.test.js.map