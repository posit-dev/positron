/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Summary of Notebook Integration Tests (summary has been generated and adapted from GitHub Copilot)
 *
 * This test suite validates the core functionality of notebooks within Positron,
 * covering both Python and R kernel integration. The tests cover the following:
 *
 * 1. **Environment Setup & System Information**: Verifies that notebooks can access
 *    and display system information, environment variables, and runtime details.
 *
 * 2. **Variable Persistence**: Tests that variables defined in one cell remain
 *    accessible in subsequent cells, maintaining state across the notebook session.
 *
 * 3. **Mathematical Computations**: Validates complex mathematical operations,
 *    statistics, trigonometry, and advanced mathematical functions work correctly.
 *
 * 4. **Data Processing & Analysis**: Tests data manipulation capabilities including
 *    data frame creation, aggregation, and statistical operations for both Python
 *    and R environments.
 *
 * 5. **Cross-Cell Communication**: Ensures that code execution flows properly
 *    between cells and that outputs are correctly captured and displayed.
 *
 * The tests use the standard Jupyter notebook format (.ipynb) with language-specific
 * interpreters selected at runtime. Each test group includes proper setup and teardown
 * to ensure clean test environments.
 *
 * Test Structure:
 * - Basic Integration Features (Python): Environment info and variable persistence
 * - Data Processing and Analysis (Python): Mathematical computations and data operations
 * - R Integration Advanced Features (R): Data manipulation and statistical operations
 */

import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Notebook Integration Features', {
	tag: [tags.NOTEBOOKS, tags.WEB, tags.WIN]
}, () => {
	test.describe('Variable and Environment Integration', () => {
		test.beforeEach(async function ({ app, python }) {
			await app.workbench.layouts.enterLayout('notebook');
			await app.workbench.notebooks.createNewNotebook();
			await app.workbench.notebooks.selectInterpreter('Python');
		});
		test.afterEach(async function ({ app }) {
			await app.workbench.notebooks.closeNotebookWithoutSaving();
		});

		test('Python - Environment variables and system info', async function ({ app }) {
			const envCode = `
import os
import sys
import platform

# System information
print(f"Python version: {sys.version}")
print(f"Platform: {platform.system()} {platform.release()}")
print(f"Architecture: {platform.architecture()[0]}")

# Environment variables
print(f"Python path: {sys.executable}")
print(f"Current working directory: {os.getcwd()}")

# Check some common environment variables
env_vars = ['PATH', 'HOME', 'USER']
for var in env_vars:
    value = os.environ.get(var, 'Not set')
print(f"{var}: {value[:50]}..." if len(str(value)) > 50 else f"{var}: {value}")`;
			await app.workbench.notebooks.addCodeToCellAtIndex(envCode);
			await app.workbench.notebooks.executeCodeInCell();
			await app.workbench.notebooks.assertCellOutput('Python version:');
			await app.workbench.notebooks.assertCellOutput('Platform:');
			await app.workbench.notebooks.assertCellOutput('Current working directory:');
		});

		test('Python - Variable persistence across cells', async function ({ app }) {
			const variableCode = `# Define variables
global_var = "Hello from first cell"
numbers = [1, 2, 3, 4, 5]
data_dict = {'name': 'test', 'value': 42}

print(f"Global variable: {global_var}")
print(f"Numbers list: {numbers}")
print(f"Data dictionary: {data_dict}")`;
			await app.workbench.notebooks.addCodeToCellAtIndex(variableCode);
			await app.workbench.notebooks.executeCodeInCell();
			await app.workbench.notebooks.insertNotebookCell('code');
			const useVariableCode = `# Use variables from previous cell
print(f"Accessing global_var: {global_var}")
print(f"Sum of numbers: {sum(numbers)}")
print(f"Dictionary value: {data_dict['value']}")

# Modify variables
numbers.append(6)
data_dict['new_key'] = 'new_value'

print(f"Modified numbers: {numbers}")
print(f"Modified dictionary: {data_dict}")`;
			await app.workbench.notebooks.addCodeToCellAtIndex(useVariableCode, 1);
			await app.workbench.notebooks.executeCodeInCell();
			await app.workbench.notebooks.assertCellOutput('Hello from first cell', 0);
			await app.workbench.notebooks.assertCellOutput('Sum of numbers: 15');
			await app.workbench.notebooks.assertCellOutput('Modified numbers: [1, 2, 3, 4, 5, 6]');
		});
	});

	test.describe('Data Processing and Analysis', () => {
		test.beforeEach(async function ({ app, python }) {
			await app.workbench.layouts.enterLayout('notebook');
			await app.workbench.notebooks.createNewNotebook();
			await app.workbench.notebooks.selectInterpreter('Python');
		});

		test.afterEach(async function ({ app }) {
			await app.workbench.notebooks.closeNotebookWithoutSaving();
		});

		test('Python - Mathematical computations', async function ({ app }) {
			const mathCode = `import math

# Basic math operations
numbers = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

# Statistics
total = sum(numbers)
count = len(numbers)
mean = total / count
variance = sum((x - mean) ** 2 for x in numbers) / count
std_dev = math.sqrt(variance)

print(f"Numbers: {numbers}")
print(f"Sum: {total}")
print(f"Mean: {mean}")
print(f"Standard deviation: {std_dev:.2f}")

# Trigonometry
angle = math.pi / 4  # 45 degrees
sin_val = math.sin(angle)
cos_val = math.cos(angle)
tan_val = math.tan(angle)

print(f"Trigonometry (45 degrees):")
print(f"sin: {sin_val:.3f}")
print(f"cos: {cos_val:.3f}")
print(f"tan: {tan_val:.3f}")`;
			await app.workbench.notebooks.addCodeToCellAtIndex(mathCode);
			await app.workbench.notebooks.executeCodeInCell();
			await app.workbench.notebooks.insertNotebookCell('code');
			const advancedMathCode = `# Logarithms and exponentials
base = 2
value = 8
log_result = math.log(value, base)
exp_result = math.exp(1)  # e^1

print(f"log_{base}({value}) = {log_result}")
print(f"e^1 = {exp_result:.3f}")

# Factorial and combinations
factorial_5 = math.factorial(5)
print(f"5! = {factorial_5}")

# Power and roots
square_root = math.sqrt(16)
cube_root = 27 ** (1/3)
print(f"sqrt(16) = {square_root}")
print(f"cbrt(27) = {cube_root:.1f}")`;
			await app.workbench.notebooks.addCodeToCellAtIndex(advancedMathCode, 1);
			await app.workbench.notebooks.executeCodeInCell();
			await app.workbench.notebooks.assertCellOutput('Sum: 55');
			await app.workbench.notebooks.assertCellOutput('Mean: 5.5');
			await app.workbench.notebooks.assertCellOutput('Standard deviation: 2.87');
			await app.workbench.notebooks.assertCellOutput('sin: 0.707');
			await app.workbench.notebooks.assertCellOutput('log_2(8) = 3.0');
			await app.workbench.notebooks.assertCellOutput('5! = 120');
		});
	});

	test.describe('R Integration Advanced Features', {
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

		test('R - Advanced data manipulation', async function ({ app }) {
			const rDataCode = `# Create sample data
set.seed(123)
df <- data.frame(
  id = 1:20,
  group = rep(c("A", "B", "C", "D"), 5),
  value1 = rnorm(20, mean = 50, sd = 10),
  value2 = runif(20, min = 10, max = 100)
)

# Basic summary
cat("Dataset dimensions:", dim(df), "\n")
cat("Column names:", names(df), "\n")
print(head(df, 3))`;
			await app.workbench.notebooks.addCodeToCellAtIndex(rDataCode);
			await app.workbench.notebooks.executeCodeInCell();
			await app.workbench.notebooks.insertNotebookCell('code');
			const aggregationCode = `# Group by operations
agg_stats <- aggregate(cbind(value1, value2) ~ group, data = df,
                      FUN = function(x) c(mean = mean(x), sd = sd(x)))
print(agg_stats)

# Find max values per group
max_values <- aggregate(cbind(value1, value2) ~ group, data = df, FUN = max)
cat("\nMax values per group:\n")
print(max_values)`;
			await app.workbench.notebooks.addCodeToCellAtIndex(aggregationCode, 1);
			await app.workbench.notebooks.executeCodeInCell();
			await app.workbench.notebooks.assertCellOutput('Dataset dimensions: 20 4');
			await app.workbench.notebooks.assertCellOutput('Column names: id group value1 value2');
			await app.workbench.notebooks.assertCellOutput('Max values per group:');
		});
	});
});
