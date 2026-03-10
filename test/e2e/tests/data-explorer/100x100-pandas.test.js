"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const _test_setup_1 = require("../_test.setup");
const path_1 = require("path");
const _100x100_1 = require("./helpers/100x100");
_test_setup_1.test.use({
    suiteId: __filename
});
_test_setup_1.test.describe('Data Explorer 100x100', () => {
    (0, _test_setup_1.test)('Python Pandas - verify data values in 100x100', {
        tag: [_test_setup_1.tags.WIN, _test_setup_1.tags.DATA_EXPLORER]
    }, async function ({ app, python }) {
        _test_setup_1.test.slow();
        const dataFrameName = 'pandas100x100';
        await (0, _100x100_1.testDataExplorer)(app, 'Python', [
            'import pandas as pd',
            `${dataFrameName} = pd.read_parquet("${(0, _100x100_1.parquetFilePath)(app)}")`,
        ], dataFrameName, (0, path_1.join)(app.workspacePathOrFolder, 'data-files', '100x100', 'pandas-100x100.tsv'));
    });
});
//# sourceMappingURL=100x100-pandas.test.js.map