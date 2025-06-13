/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// This helper contains expected column names and a Python script that generates a data frame with similar names.
export const expectedColumnNames = [
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
];

/* I'm commenting this out since it's not needed to test Positron (it actually tests pandas' df ability)

Note that there are discrepancies for the following column names (between UI method vs. console)
* 'column04 vs. 'Unnamed: 4'
* 'duplicate_1' vs. 'duplicate.1'

export const pyColumnComparison = `
import pandas as pd;
df = pd.read_csv("data-files/data_explorer/data_columns.csv");
expected = [
	'normal_name',
	'leading_space',
	'trailing_space',
	'both',
	'Unnamed: 4',
	'123numeric_start',
	'!@#symbols',
	'中文字符',
	'naïve_column',
	'name,with,comma',
	'"quoted"',
	'''multiline\nheader''',
	'supercalifragilisticexpialidocious_column_name_that_is_really_really_long_to_test_limits',
	'''whitespace\t(tab)''',
	'duplicate',
	'duplicate.1',
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
];
actual = [col.strip() for col in df.columns];
print(actual == expected)
`;

*/
