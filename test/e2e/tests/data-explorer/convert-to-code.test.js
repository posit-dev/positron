"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const _test_setup_1 = require("../_test.setup");
const convert_to_code_data_js_1 = require("./helpers/convert-to-code-data.js");
const testCases = [
    {
        environment: 'DuckDB',
        data: 'data-files/convert-to-code/simple-student-data.csv',
        expectedCodeStyle: 'SQL',
        dataObjectType: 'file.csv',
        expectedGeneratedCode: 'SELECT * \nFROM "simple-student-data"\nWHERE "status" = \'active\' AND "score" >= 85 AND "is_student" = false'
    },
    {
        environment: 'Python',
        data: convert_to_code_data_js_1.pandasDataFrameScript,
        expectedCodeStyle: 'Pandas',
        dataObjectType: 'py.pandas.DataFrame',
        expectedGeneratedCode: 'filter_mask = (df[\'status\'] == \'active\') & (df[\'score\'] >= 85) & (df[\'is_student\'] == False)\ndf[filter_mask]'
    },
    {
        environment: 'Python',
        data: convert_to_code_data_js_1.polarsDataFrameScript,
        expectedCodeStyle: 'Polars',
        dataObjectType: 'py.polars.DataFrame',
        expectedGeneratedCode: "filter_expr = (pl.col('status') == 'active') & (pl.col('score') >= 85) & (pl.col('is_student') == False)\ndf.filter(filter_expr)"
    },
    {
        environment: 'R',
        data: convert_to_code_data_js_1.dplyrScript,
        expectedCodeStyle: 'dplyr',
        dataObjectType: 'r.tibble',
        expectedGeneratedCode: 'library(dplyr)\n\ndf |>\n  filter(\n    status == "active",\n    score >= 85,\n    !is_student\n  )'
    },
    // {
    //   environment: 'R',
    //   data: rDataFrameScript,
    //   expectedCodeStyle: 'Base R',
    //   dataObjectType: 'r.data.frame',
    //   expectedGeneratedCode: 'df[df$status == "active" & df$score >= 85 & !df$is_student, ]'
    // },
    // {
    //   environment: 'R',
    //   data: dataTableScript,
    //   expectedCodeStyle: 'data.table',
    //   dataObjectType: 'r.data.table',
    //   expectedGeneratedCode: 'df[status == "active" & score >= 85 & !is_student]'
    // }
];
_test_setup_1.test.use({
    suiteId: __filename
});
_test_setup_1.test.describe('Data Explorer: Convert to Code', { tag: [_test_setup_1.tags.WIN, _test_setup_1.tags.DATA_EXPLORER, _test_setup_1.tags.PERFORMANCE] }, () => {
    _test_setup_1.test.afterEach(async function ({ hotKeys }) {
        await hotKeys.closeAllEditors();
    });
    testCases.forEach(({ environment, data: dataScript, expectedCodeStyle, dataObjectType, expectedGeneratedCode }) => {
        (0, _test_setup_1.test)(`${environment} - ${expectedCodeStyle} (${dataObjectType}) - Verify copy code behavior with basic filters`, async function ({ app, sessions, hotKeys, metric, openDataFile }) {
            const { dataExplorer, variables, modals, console, clipboard, toasts } = app.workbench;
            if (environment === 'DuckDB') {
                // open a data file via DuckDB
                await openDataFile(dataScript);
            }
            else {
                // execute code to create a data construct
                await sessions.start(environment === 'Python' ? 'python' : 'r');
                await console.pasteCodeToConsole(dataScript, true);
                await variables.doubleClickVariableRow('df');
            }
            await hotKeys.closeSecondarySidebar();
            // verify the data in the table
            await dataExplorer.grid.verifyTableData([
                { name: 'Alice', age: 25, city: 'Austin' },
                { name: 'Bob', age: 35, city: 'Dallas' },
                { name: 'Charlie', age: 40, city: 'Austin' },
                { name: 'Diana', age: '__MISSING__', city: 'Houston' }
            ]);
            // add filters
            await dataExplorer.filters.add({ columnName: 'status', condition: 'is equal to', value: 'active' }); // Alice & Charlie
            await dataExplorer.filters.add({ columnName: 'score', condition: 'is greater than or equal to', value: '85' }); // Alice (89.5), Charlie (95.0)
            await dataExplorer.filters.add({ columnName: 'is_student', condition: 'is false', value: '' }); // Charlie only
            await metric.dataExplorer.toCode(async () => {
                // copy code and verify result is accurate
                await dataExplorer.editorActionBar.clickButton('Convert to Code');
                await modals.expectButtonToBeVisible(expectedCodeStyle.toLowerCase());
                await dataExplorer.convertToCodeModal.expectToBeVisible();
                // verify the generated code is correct - use normalized code (no newlines)
                await (0, _test_setup_1.expect)(dataExplorer.convertToCodeModal.codeBox).toContainText((0, convert_to_code_data_js_1.normalizeCodeForDisplay)(expectedGeneratedCode));
            }, dataObjectType);
            // verify syntax highlighting
            if (environment !== 'DuckDB') {
                await dataExplorer.convertToCodeModal.expectSyntaxHighlighting();
            }
            // verify copy to clipboard behavior - use un-normalized code (with newlines)
            await dataExplorer.convertToCodeModal.clickOK();
            await clipboard.expectClipboardTextToBe(expectedGeneratedCode);
            await toasts.expectToastWithTitle('Copied to clipboard');
        });
    });
});
//# sourceMappingURL=convert-to-code.test.js.map