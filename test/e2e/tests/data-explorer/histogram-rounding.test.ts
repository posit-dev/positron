/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * This test suite verifies that histogram bin ranges in the Data Explorer are properly rounded
 * and displayed with appropriate precision for different numeric scales.
 *
 * The Data Explorer generates histograms for numeric columns with binned ranges. This suite tests
 * that the bin edge values are correctly rounded and formatted across various data ranges:
 * - Integer ranges (whole numbers)
 * - Positive decimal ranges
 * - Ranges spanning negative to positive values
 * - Very small values requiring scientific notation
 *
 * Each test case creates a DataFrame with specific numeric values, opens it in the Data Explorer,
 * displays the summary panel with histograms, and verifies that hovering over histogram bins shows
 * tooltips with the expected rounded range values.
 *
 * Histogram Rounding Test Cases
 *
 * | Case | Data Range        | Expected Bins                                      | Description                          |
 * |------|-------------------|----------------------------------------------------|--------------------------------------|
 * | 1    | 0.0 -> 100.0       | 0-33, 34-66, 67-100                                | Integer range with whole number bins |
 * | 2    | 1.10 -> 3.90       | 1.10-2.03, 2.03-2.97, 2.97-3.90                    | Decimal range with 2-digit precision  |
 * | 3    | -1.10 -> 2.00      | -1.10-0.4500, 0.4500-2.00                          | Mixed negative/positive decimal range |
 * | 4    | -0.0001 -> 0.00009 | -0.0001--5.00E-06, -5.00E-06-9.00E-05              | Very small values with scientific notation |
 */

import { test, tags } from '../_test.setup';

test.use({
  suiteId: __filename
});

test.describe('Data Explorer - Histogram Rounding', {
  tag: [tags.WEB, tags.WIN, tags.DATA_EXPLORER]
}, () => {

  test.afterEach(async ({ hotKeys }) => {
    await hotKeys.closeAllEditors();
  });



  const cases = [
    {
      name: 'Case 1: 0.0 -> 100.0 -> Bins: 0-33, 34-66, 67-100',
      varName: 'histRound1',
      python: `import pandas as pd\n# Integer range 0..100\nhistRound1 = pd.DataFrame({'x': list(range(0, 101, 10))})`,
      expectedPairs: [
        { min: '0', max: '33' },
        { min: '34', max: '66' },
        { min: '67', max: '100' }
      ]
    },
    {
      name: 'Case 2: 1.10 -> 3.90 -> Bins: 1.10-2.03, 2.03-2.97, 2.97-3.90',
      varName: 'histRound2',
      python: `import pandas as pd\n# Floating range ~[1.1, 3.9]\nhistRound2 = pd.DataFrame({'x': [1.1, 1.8, 2.0, 2.5, 3.0, 3.4, 3.9]})`,
      expectedPairs: [
        { min: '1.10', max: '2.03' },
        { min: '2.03', max: '2.97' },
        { min: '2.97', max: '3.90' }
      ]
    },
    {
      name: 'Case 3: -1.10 -> 2.00 -> Bins: -1.10-0.4500, 0.4500-2.00',
      varName: 'histRound3',
      python: `import pandas as pd\n# Floating range ~[-1.1, 2.0]\nhistRound3 = pd.DataFrame({'x': [-1.1, -0.5, 0.0, 1.1, 2.0]})`,
      expectedPairs: [
        { min: '-1.10', max: '0.4500' },
        { min: '0.4500', max: '2.00' }
      ]
    },
    {
      name: 'Case 4: -0.0001 -> 0.00009 -> Bins: -0.0001--5.00E-06, -5.00E-06-9.00E-05',
      varName: 'histRound4',
      python: `import pandas as pd\n# Tiny values around zero\nhistRound4 = pd.DataFrame({'x': [-0.0001, -0.00005, 0.0, 0.00005, 0.00009]})`,
      expectedPairs: [
        { min: '-0.0001', max: '-5.00E-06' },
        { min: '-5.00E-06', max: '9.00E-05' }
      ]
    }
  ];

  for (const testCase of cases) {
    test(testCase.name, async ({ app, python }) => {
      const { dataExplorer, variables, editors } = app.workbench;
      await app.workbench.console.pasteCodeToConsole(testCase.python, true);

      await variables.doubleClickVariableRow(testCase.varName);
      await editors.verifyTab(`Data: ${testCase.varName}`, { isVisible: true });

      await dataExplorer.maximize(true);

      await dataExplorer.summaryPanel.waitForVectorHistogramVisible(10000);

      // Hover bins until all expected ranges are found
      for (const pair of testCase.expectedPairs) {
        await dataExplorer.summaryPanel.hoverHistogramBinWithRange(pair.min, pair.max);
      }
    });
  }
});
