"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const _test_setup_1 = require("../_test.setup");
_test_setup_1.test.use({
    suiteId: __filename
});
_test_setup_1.test.describe('Data Explorer - Sparklines', {
    tag: [_test_setup_1.tags.WEB, _test_setup_1.tags.WIN, _test_setup_1.tags.DATA_EXPLORER]
}, () => {
    _test_setup_1.test.beforeEach(async function ({ hotKeys }) {
        await hotKeys.stackedLayout();
    });
    _test_setup_1.test.afterEach(async ({ hotKeys }) => {
        await hotKeys.closeAllEditors();
    });
    (0, _test_setup_1.test)('Python Pandas - Verify downward trending graph', async ({ app, executeCode, hotKeys, python }) => {
        const { dataExplorer, variables, editors } = app.workbench;
        await executeCode('Python', pythonScript);
        await variables.doubleClickVariableRow('pythonData');
        await editors.verifyTab('Data: pythonData', { isVisible: true });
        await hotKeys.closePrimarySidebar();
        await hotKeys.closeSecondarySidebar();
        await dataExplorer.summaryPanel.show();
        await dataExplorer.summaryPanel.verifySparklineHeights([{ column: 1, expected: ['50.0', '40.0', '30.0', '20.0', '10.0'] }]);
    });
    (0, _test_setup_1.test)('R - Verify downward trending graph', async ({ app, executeCode, hotKeys, r }) => {
        const { dataExplorer, variables, editors } = app.workbench;
        await executeCode('R', rScript);
        await variables.doubleClickVariableRow('rData');
        await editors.verifyTab(`Data: rData`, { isVisible: true });
        await hotKeys.closePrimarySidebar();
        await hotKeys.closeSecondarySidebar();
        await dataExplorer.summaryPanel.show();
        await dataExplorer.summaryPanel.verifySparklineHeights([{ column: 1, expected: ['50.0', '40.0', '30.0', '20.0', '10.0'] }]);
    });
});
const rScript = `library(dplyr)

rData <- tibble(
category = c("A", "A", "A", "A", "B", "B", "B", "C", "C", "D", "E", "A", "B", "C", "D"),
values = c(1, 2, 3, 4, 5, 9, 10, 11, 13, 25, 7, 15, 20, 5, 6)
)`;
const pythonScript = `import pandas as pd
import matplotlib.pyplot as plt

pythonData = pd.DataFrame({
'category': ['A', 'A', 'A', 'A', 'B', 'B', 'B', 'C', 'C', 'D', 'E', 'A', 'B', 'C', 'D'],
'values': [1, 2, 3, 4, 5, 9, 10, 11, 13, 25, 7, 15, 20, 5, 6]
})`;
//# sourceMappingURL=sparklines.test.js.map