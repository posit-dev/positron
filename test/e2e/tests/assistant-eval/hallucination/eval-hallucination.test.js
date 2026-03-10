"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const _test_setup_1 = require("../../_test.setup");
const eval_runner_1 = require("../_helpers/eval-runner");
const r_forested_hallucination_1 = require("./r-forested-hallucination");
const python_no_execution_hallucination_1 = require("./python-no-execution-hallucination");
_test_setup_1.test.use({ suiteId: __filename });
_test_setup_1.test.describe('Assistant Eval: Hallucination', { tag: [eval_runner_1.tags.ASSISTANT_EVAL] }, () => {
    (0, eval_runner_1.evalTests)(_test_setup_1.test, [
        r_forested_hallucination_1.rForestedHallucination,
        python_no_execution_hallucination_1.pythonNoExecutionHallucination,
    ], { category: 'hallucination' });
});
//# sourceMappingURL=eval-hallucination.test.js.map