/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { test } from '../tests/_test.setup';
import { captureFullWindow } from './helpers/screenshot-utils';
import { overrideWorkspaceName, prepareForScreenshot, setScreenshotWindowSize } from './helpers/layout-utils';
import { annotate, clearAnnotations } from './helpers/annotate-utils';

const ANNOTATION_COLOR = '#dc2626';

const DATA_TYPES_R = `# Numbers
count <- 5L
price <- 19.99

# Strings
first_name <- "Alice"
city <- "Seattle"

# Vector
scores <- c(88, 92, 75, 95, 81)

# Boolean
is_active <- TRUE

# Data Frame
employees <- data.frame(
name = c("Alice", "Bob", "Charlie"),
age = c(30, 25, 35),
salary = c(85000, 65000, 92000)
)
`;

const BASICS_R = `# Variable Assignment
x <- 10
y <- 5

# Arithmetic
sum <- x + y
diff <- x - y
prod <- x * y
quot <- x / y
`;

test.use({
	suiteId: __filename,
});

test.beforeEach(async ({ app }) => {
	await setScreenshotWindowSize(app);
});

test.afterEach(async ({ app, page }) => {
	await page.keyboard.press('Escape');
	await clearAnnotations(page);
	await app.workbench.hotKeys.closeAllEditors();
});

test.describe('Release Screenshots - Interpreter Session', () => {

	/**
	 * Img Path: https://positron.posit.co/images/variables-pane.png
	 *
	 * R session with several variables assigned, Variables view visible in the
	 * secondary side bar.
	 */
	test('Release Screenshot - variables-pane.png', async ({ app, page, openFile, executeCode, r }) => {
		const { sessions, variables, hotKeys, layouts } = app.workbench;
		await sessions.expectAllSessionsToBeReady();

		writeFileSync(join(app.workspacePathOrFolder, 'data_types.R'), DATA_TYPES_R);
		await openFile('data_types.R');
		await executeCode('R', DATA_TYPES_R, { maximizeConsole: false });

		await hotKeys.closePrimarySidebar();
		await variables.focusVariablesView();
		// Hide the Plots split-view pane from the auxiliary bar so the shot
		// matches the docs reference (Variables only). Hiding via CSS rather
		// than the `<viewId>.removeView` command because that command's title
		// is "Hide 'Plots'", which the command-palette fuzzy match doesn't
		// reliably resolve from the raw command ID.
		await page.evaluate(() => {
			const header = document.querySelector('.part.auxiliarybar [aria-label="Plots Section"]');
			const pane = header?.closest('.split-view-view') as HTMLElement | null;
			if (pane) {
				pane.style.display = 'none';
			}
		});
		await layouts.resizeAuxiliaryBar({ x: -300 });
		await expect(variables.variablesPane).toBeVisible();

		await layouts.resizePanel({ y: -200 });
		await prepareForScreenshot(app, page);
		await overrideWorkspaceName(page, 'qa-example-content', 'my-project');
		await captureFullWindow(page, 'variables-pane.png');
	});

	/**
	 * Img Path: https://positron.posit.co/images/active-interpreter-session.png
	 *
	 * R and Python sessions running side-by-side, Sessions view visible in the
	 * secondary side bar, with an annotation on the top-right interpreter chip.
	 */
	test('Release Screenshot - active-interpreter-session.png', async ({ app, page, openFile }) => {
		const { sessions, hotKeys, layouts } = app.workbench;
		// Smaller window so the chrome and Sessions cards read proportionally
		// larger in the docs page; matches astropy.png sizing.
		await setScreenshotWindowSize(app, { width: 1280, height: 800 });
		await sessions.start(['python', 'r']);
		await sessions.expectAllSessionsToBeReady();

		writeFileSync(join(app.workspacePathOrFolder, 'basics.R'), BASICS_R);
		await openFile('basics.R');

		await hotKeys.closePrimarySidebar();
		// Close the aux bar entirely — the Sessions cards this shot is meant
		// to highlight now live in the bottom panel, not the aux bar.
		await hotKeys.closeSecondarySidebar();
		await layouts.resizePanel({ y: 150 });

		await prepareForScreenshot(app, page);
		await overrideWorkspaceName(page, 'qa-example-content', 'my-project');
		await annotate(page, [
			{ selector: '.top-action-bar-session-manager-face', label: '', color: ANNOTATION_COLOR, padding: 3 },
		]);
		await captureFullWindow(page, 'active-interpreter-session.png');
	});
});
