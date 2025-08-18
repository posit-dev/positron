/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { test, expect, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Notebook Advanced Features', {
	tag: [tags.NOTEBOOKS, tags.WIN, tags.WEB]
}, () => {

	test.describe('Cell Management and Manipulation', () => {
		test.beforeEach(async function ({ app, python }) {
			await app.workbench.layouts.enterLayout('notebook');
			await app.workbench.notebooks.createNewNotebook();
			await app.workbench.notebooks.selectInterpreter('Python');
		});

		test.afterEach(async function ({ app }) {
			await app.workbench.notebooks.closeNotebookWithoutSaving();
		});

		test('Python - Insert and delete multiple cells', async function ({ app, page }) {
			// Start with one cell, add code
			await app.workbench.notebooks.addCodeToCellAtIndex('print("Cell 1")');

			// Insert multiple cells
			await app.workbench.notebooks.insertNotebookCell('code');
			await app.workbench.notebooks.addCodeToCellAtIndex('print("Cell 2")', 1);

			await app.workbench.notebooks.insertNotebookCell('markdown');
			await app.workbench.notebooks.typeInEditor('# Markdown Cell');
			// await app.workbench.notebooks.stopEditingCell();

			await app.workbench.notebooks.insertNotebookCell('code');
			await app.workbench.notebooks.addCodeToCellAtIndex('print("Cell 4")', 3);

			// Verify we have 4 cells
			const cellCount = await page.locator('.cell-inner-container > .cell').count();
			expect(cellCount).toBe(4);

			// Execute all code cells
			await app.workbench.notebooks.selectCellAtIndex(0);
			await app.workbench.notebooks.executeCodeInCell();
			await app.workbench.notebooks.selectCellAtIndex(1);
			await app.workbench.notebooks.executeCodeInCell();
			await app.workbench.notebooks.selectCellAtIndex(3);
			await app.workbench.notebooks.executeCodeInCell();

			// Verify outputs
			await app.workbench.notebooks.assertCellOutput('Cell 1');
			await app.workbench.notebooks.assertCellOutput('Cell 2');
			await app.workbench.notebooks.assertCellOutput('Cell 4');

			// Verify markdown rendering
			await app.workbench.notebooks.assertMarkdownText('h1', 'Markdown Cell');

			// Delete middle cells
			await page.locator('.cell-inner-container > .cell').nth(1).click();
			await page.getByRole('button', { name: 'Delete Cell' }).click();

			// Verify cell count reduced
			const newCellCount = await page.locator('.cell-inner-container > .cell').count();
			expect(newCellCount).toBe(3);
		});

		test('Python - Cell execution order and state persistence', async function ({ app }) {
			// Create variable in first cell
			await app.workbench.notebooks.addCodeToCellAtIndex('x = 42');
			await app.workbench.notebooks.executeCodeInCell();

			// Insert cell above and modify variable
			await app.workbench.notebooks.insertNotebookCell('code');
			await app.workbench.notebooks.addCodeToCellAtIndex('x = x * 2', 1);

			// Insert cell below to print result
			await app.workbench.notebooks.insertNotebookCell('code');
			await app.workbench.notebooks.addCodeToCellAtIndex('print(f"x = {x}")', 2);

			// Execute cells in order: middle, then bottom
			await app.workbench.notebooks.selectCellAtIndex(1);
			await app.workbench.notebooks.executeCodeInCell();
			await app.workbench.notebooks.selectCellAtIndex(2);
			await app.workbench.notebooks.executeCodeInCell();

			// Should show modified value
			await app.workbench.notebooks.assertCellOutput('x = 84');
		});

		test('Python - Mixed cell types with complex markdown', async function ({ app }) {
			// Add code cell with data
			await app.workbench.notebooks.addCodeToCellAtIndex('data = [1, 2, 3, 4, 5]\nsum_data = sum(data)');
			await app.workbench.notebooks.executeCodeInCell();

			// Add markdown with various formatting
			await app.workbench.notebooks.insertNotebookCell('markdown');
			const markdownContent = `# Data Analysis Results

## Summary
- **Total items**: 5
- **Data type**: List
- *Processing*: Complete

### Code Block
\`\`\`python
print("Hello World")
\`\`\`

> This is a blockquote with analysis notes.`;
			await app.workbench.notebooks.typeInEditor(markdownContent);
			await app.workbench.notebooks.stopEditingCell();

			// Add another code cell to display results
			await app.workbench.notebooks.insertNotebookCell('code');
			await app.workbench.notebooks.addCodeToCellAtIndex('print(f"Sum: {sum_data}, Average: {sum_data/len(data)}")', 2);
			await app.workbench.notebooks.executeCodeInCell();

			// Verify markdown elements
			await app.workbench.notebooks.assertMarkdownText('h1', 'Data Analysis Results');
			await app.workbench.notebooks.assertMarkdownText('h2', 'Summary');
			await app.workbench.notebooks.assertMarkdownText('h3', 'Code Block');

			// Verify code output
			await app.workbench.notebooks.assertCellOutput('Sum: 15, Average: 3.0');
		});
	});

	test.describe('Error Handling and Recovery', () => {
		test.beforeEach(async function ({ app, python }) {
			await app.workbench.layouts.enterLayout('notebook');
			await app.workbench.notebooks.createNewNotebook();
			await app.workbench.notebooks.selectInterpreter('Python');
		});

		test.afterEach(async function ({ app }) {
			await app.workbench.notebooks.closeNotebookWithoutSaving();
		});

		test('Python - Handle syntax errors gracefully', async function ({ app }) {
			// Add cell with syntax error
			await app.workbench.notebooks.addCodeToCellAtIndex('print("Missing closing quote');
			await app.workbench.notebooks.executeCodeInCell();

			// Should show syntax error
			await app.workbench.notebooks.assertCellOutput(/SyntaxError|EOL while scanning/);

			// Fix the syntax error
			await app.workbench.notebooks.selectCellAtIndex(0);
			await app.workbench.notebooks.typeInEditor('print("Fixed quote")');
			await app.workbench.notebooks.executeCodeInCell();

			// Should now work correctly
			await app.workbench.notebooks.assertCellOutput('Fixed quote');
		});

		test('Python - Runtime error recovery', async function ({ app }) {
			// Create variable
			await app.workbench.notebooks.addCodeToCellAtIndex('numbers = [1, 2, 3]');
			await app.workbench.notebooks.executeCodeInCell();

			// Add cell with runtime error
			await app.workbench.notebooks.insertNotebookCell('code');
			await app.workbench.notebooks.addCodeToCellAtIndex('result = numbers[10]  # Index out of range', 1);
			await app.workbench.notebooks.executeCodeInCell();

			// Should show IndexError
			await app.workbench.notebooks.assertCellOutput(/IndexError/);

			// Add recovery cell
			await app.workbench.notebooks.insertNotebookCell('code');
			await app.workbench.notebooks.addCodeToCellAtIndex('result = numbers[0] if len(numbers) > 0 else None\nprint(f"Safe result: {result}")', 2);
			await app.workbench.notebooks.executeCodeInCell();

			// Should recover and show correct result
			await app.workbench.notebooks.assertCellOutput('Safe result: 1');
		});

		test('Python - Import error handling', async function ({ app }) {
			// Try to import non-existent module
			await app.workbench.notebooks.addCodeToCellAtIndex('import nonexistent_module');
			await app.workbench.notebooks.executeCodeInCell();

			// Should show ModuleNotFoundError
			await app.workbench.notebooks.assertCellOutput(/ModuleNotFoundError/);

			// Add fallback import
			await app.workbench.notebooks.insertNotebookCell('code');
			await app.workbench.notebooks.addCodeToCellAtIndex('try:\n    import nonexistent_module\nexcept ImportError:\n    print("Module not found, using fallback")\n    nonexistent_module = None', 1);
			await app.workbench.notebooks.executeCodeInCell();

			// Should handle gracefully
			await app.workbench.notebooks.assertCellOutput('Module not found, using fallback');
		});
	});

	test.describe('Output and Display Features', () => {
		test.beforeEach(async function ({ app, python }) {
			await app.workbench.layouts.enterLayout('notebook');
			await app.workbench.notebooks.createNewNotebook();
			await app.workbench.notebooks.selectInterpreter('Python');
		});

		test.afterEach(async function ({ app }) {
			await app.workbench.notebooks.closeNotebookWithoutSaving();
		});

		test('Python - Multiple output types in single cell', async function ({ app }) {
			// Cell with multiple outputs
			const multiOutputCode = `print("Text output")
print("Line 2")
42  # Expression result
print("Final line")`;
			await app.workbench.notebooks.addCodeToCellAtIndex(multiOutputCode);
			await app.workbench.notebooks.executeCodeInCell();

			// Verify multiple outputs are displayed
			await app.workbench.notebooks.assertCellOutput('Text output');
			await app.workbench.notebooks.assertCellOutput('Line 2');
			await app.workbench.notebooks.assertCellOutput('Final line');
		});

		test('Python - Long output handling', async function ({ app }) {
			// Generate long output
			const longOutputCode = `for i in range(50):\n    print(f"Line {i+1}: This is a long line with some content to test output handling")`;
			await app.workbench.notebooks.addCodeToCellAtIndex(longOutputCode);
			await app.workbench.notebooks.executeCodeInCell();

			// Verify some lines are present
			await app.workbench.notebooks.assertCellOutput('Line 1: This is a long line');
			await app.workbench.notebooks.assertCellOutput('Line 50: This is a long line');
		});

		test('Python - Rich output with HTML-like content', async function ({ app }) {
			// Test output with special characters
			const richOutputCode = `print("<b>Bold text</b>")\nprint("Special chars: àáâãäåæçèéêë")\nprint("Math: α + β = γ")\nprint("Emoji: 🐍 🚀 ✨")`;
			await app.workbench.notebooks.addCodeToCellAtIndex(richOutputCode);
			await app.workbench.notebooks.executeCodeInCell();

			// Verify special content is displayed
			await app.workbench.notebooks.assertCellOutput('<b>Bold text</b>');
			await app.workbench.notebooks.assertCellOutput('Special chars: àáâãäåæçèéêë');
			await app.workbench.notebooks.assertCellOutput('Math: α + β = γ');
		});
	});

	test.describe('R Notebook Advanced Features', {
		tag: [tags.ARK]
	}, () => {
		test.beforeEach(async function ({ app, r }) {
			await app.workbench.layouts.enterLayout('notebook');
			await app.workbench.notebooks.createNewNotebook();
			await app.workbench.notebooks.selectInterpreter('R');
		});

		test.afterEach(async function ({ app }) {
			await app.workbench.notebooks.closeNotebookWithoutSaving();
		});

		test('R - Data frame operations and output', async function ({ app }) {
			// Create and manipulate data frame
			const dataFrameCode = `df <- data.frame(
  name = c("Alice", "Bob", "Charlie"),
  age = c(25, 30, 35),
  city = c("NYC", "LA", "Chicago")
)
print(df)
summary(df)`;
			await app.workbench.notebooks.addCodeToCellAtIndex(dataFrameCode);
			await app.workbench.notebooks.executeCodeInCell();

			// Verify data frame output
			await app.workbench.notebooks.assertCellOutput('Alice');
			await app.workbench.notebooks.assertCellOutput('Bob');
			await app.workbench.notebooks.assertCellOutput('Charlie');
		});

		test('R - Statistical operations', async function ({ app }) {
			// Statistical calculations
			const statsCode = `numbers <- c(1, 2, 3, 4, 5, 6, 7, 8, 9, 10)
mean_val <- mean(numbers)
sd_val <- sd(numbers)
cat("Mean:", mean_val, "\n")
cat("Standard Deviation:", sd_val, "\n")`;
			await app.workbench.notebooks.addCodeToCellAtIndex(statsCode);
			await app.workbench.notebooks.executeCodeInCell();

			// Verify statistical output
			await app.workbench.notebooks.assertCellOutput('Mean: 5.5');
			await app.workbench.notebooks.assertCellOutput(/Standard Deviation: 3\.02/);
		});

		test('R - Error handling with tryCatch', async function ({ app }) {
			// R error handling
			const errorHandlingCode = `result <- tryCatch({
  # This will cause an error
  log(-1)
}, error = function(e) {
  cat("Caught error:", e$message, "\n")
  return(NA)
})
cat("Result:", result, "\n")`;
			await app.workbench.notebooks.addCodeToCellAtIndex(errorHandlingCode);
			await app.workbench.notebooks.executeCodeInCell();

			// Verify error was caught
			await app.workbench.notebooks.assertCellOutput('Caught error:');
			await app.workbench.notebooks.assertCellOutput('Result: NA');
		});
	});

	test.describe('Kernel and Session Management', () => {
		test.beforeEach(async function ({ app }) {
			await app.workbench.layouts.enterLayout('notebook');
			await app.workbench.notebooks.createNewNotebook();
		});

		test.afterEach(async function ({ app }) {
			await app.workbench.notebooks.closeNotebookWithoutSaving();
		});

		test('Python - Kernel selection and verification', async function ({ app, python }) {
			// Select Python kernel
			await app.workbench.notebooks.selectInterpreter('Python');
			await app.workbench.notebooks.expectKernelToBe(process.env.POSITRON_PY_VER_SEL!);

			// Test Python-specific functionality
			await app.workbench.notebooks.addCodeToCellAtIndex('import sys\nprint(f"Python version: {sys.version}")');
			await app.workbench.notebooks.executeCodeInCell();
			await app.workbench.notebooks.assertCellOutput(/Python version: 3\./);
		});

		test('R - Kernel selection and verification', {
			tag: [tags.ARK]
		}, async function ({ app, r }) {
			// Select R kernel
			await app.workbench.notebooks.selectInterpreter('R');
			await app.workbench.notebooks.expectKernelToBe(process.env.POSITRON_R_VER_SEL!);

			// Test R-specific functionality
			await app.workbench.notebooks.addCodeToCellAtIndex('cat("R version:", R.version.string, "\n")');
			await app.workbench.notebooks.executeCodeInCell();
			await app.workbench.notebooks.assertCellOutput(/R version: R version/);
		});
	});
});
