"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
const _test_setup_1 = require("../_test.setup");
_test_setup_1.test.use({
    suiteId: __filename
});
_test_setup_1.test.describe('Data Explorer: Column Names', { tag: [_test_setup_1.tags.WEB, _test_setup_1.tags.WIN, _test_setup_1.tags.DATA_EXPLORER] }, () => {
    (0, _test_setup_1.test)('Verify data columns', async function ({ app, openDataFile }) {
        const dataExplorer = app.workbench.dataExplorer;
        await openDataFile('data-files/data_explorer/data_columns.csv');
        await dataExplorer.maximize();
        await dataExplorer.grid.expectColumnHeadersToBe([
            'normal_name',
            'leading_space',
            'trailing_space',
            'both',
            'column04',
            '123numeric_start',
            '!@#symbols',
            '中文字符',
            'naïve_column',
            'name,with,comma',
            '"quoted"',
            'multiline header',
            'supercalifragilisticexpialidocious_column_name_that_is_really_really_long_to_test_limits',
            'whitespace (tab)',
            'duplicate',
            'duplicate_1',
            'Nombre_Español',
            'ID_Único',
            'Nome_Português',
            'Número_do_Pedido',
            'اسم_عربي',
            'رمز_المنتج',
            'שם_עברי',
            'מספר_פריט',
            'Heizölrückstoßabdämpfung',
            '100.000 pro Bevölkerung'
        ]);
    });
});
//# sourceMappingURL=data-columns.test.js.map