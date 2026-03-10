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
    (0, _test_setup_1.test)('R - verify data values in 100x100', {
        tag: [_test_setup_1.tags.WIN, _test_setup_1.tags.DATA_EXPLORER]
    }, async function ({ app, r }) {
        _test_setup_1.test.slow();
        // Test the data explorer.
        const dataFrameName = 'r100x100';
        await (0, _100x100_1.testDataExplorer)(app, 'R', [
            'library(arrow)',
            `${dataFrameName} <- read_parquet("${(0, _100x100_1.parquetFilePath)(app)}")`,
        ], dataFrameName, (0, path_1.join)(app.workspacePathOrFolder, 'data-files', '100x100', 'r-100x100.tsv'));
    });
});
//# sourceMappingURL=100x100-r.test.js.map