/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { test } from '../../tests/_test.setup';
import { captureFullWindow } from '../_helpers/screenshot-utils';
import { overrideWorkspaceName, prepareForScreenshot, setScreenshotWindowSize } from '../_helpers/layout-utils';
import { annotate, clearAnnotations } from '../_helpers/annotate-utils';

const ANNOTATION_COLOR = '#dc2626';

// Built via array+join because the data.frame() body needs 2-space indents
// (so the console output reads "normal" to R folks), but the project hygiene
// hook rejects lines with leading spaces in source files.
const DATA_TYPES_R = [
	'# Numbers',
	'count <- 5L',
	'price <- 19.99',
	'',
	'# Strings',
	'first_name <- "Alice"',
	'city <- "Seattle"',
	'',
	'# Vector',
	'scores <- c(88, 92, 75, 95, 81)',
	'',
	'# Boolean',
	'is_active <- TRUE',
	'',
	'# Data Frame',
	'employees <- data.frame(',
	'  name = c("Alice", "Bob", "Charlie"),',
	'  age = c(30, 25, 35),',
	'  salary = c(85000, 65000, 92000)',
	')',
	'',
].join('\n');

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

test.afterEach(async ({ page, hotKeys }) => {
	await page.keyboard.press('Escape');
	await clearAnnotations(page);
	await hotKeys.closeAllEditors();
});

test.describe('Release Screenshots - Interpreter Session', () => {
	/**
	 * Img Path: https://positron.posit.co/images/variables-pane.png
	 *
	 * R session with several variables assigned, Variables view visible in the
	 * secondary side bar.
	 */
	test('Release Screenshot - variables-pane.png', async ({ app, page, openFile, executeCode, r }) => {
		const { sessions, variables, hotKeys, layouts, plots } = app.workbench;

		await setScreenshotWindowSize(app, { width: 1280, height: 800 });
		await sessions.expectAllSessionsToBeReady();

		writeFileSync(join(app.workspacePathOrFolder, 'data_types.R'), DATA_TYPES_R);
		await openFile('data_types.R');
		await executeCode('R', DATA_TYPES_R, { maximizeConsole: false });

		// customize the layout
		await hotKeys.closePrimarySidebar();
		await hotKeys.showSecondarySidebar();

		// Collapse the Plots pane and focus on variables so the Plots header doesn't have focus state.
		await plots.collapsePlotsPane();
		await variables.focusVariablesView();
		await layouts.resizeAuxiliaryBar({ x: -250 });
		await expect(variables.variablesPane).toBeVisible();

		// capture screenshot
		await layouts.resizePanel({ y: -250 });
		await prepareForScreenshot(app, page);
		await overrideWorkspaceName(page, 'qa-example-content', 'my-project');
		await captureFullWindow(page, 'variables-pane.png');
	});

	/**
	 * Img Path: https://positron.posit.co/images/active-interpreter-session.png
	 *
	 * R and Python sessions running side-by-side, Sessions list visible in the
	 * bottom panel, with an annotation on the top-right interpreter chip.
	 *
	 * Runs first so the R session is fresh — the console should show the R
	 * startup banner, not output from an earlier test's executeCode.
	 */
	test('Release Screenshot - active-interpreter-session.png', async ({ app, page, openFile }) => {
		const { sessions, hotKeys, layouts } = app.workbench;

		await setScreenshotWindowSize(app, { width: 900, height: 700 });
		const [, rSession] = await sessions.start(['python', 'r']);
		await sessions.select(rSession.id);

		writeFileSync(join(app.workspacePathOrFolder, 'basics.R'), BASICS_R);
		await openFile('basics.R');

		// customize the layout
		await hotKeys.closePrimarySidebar();
		await hotKeys.closeSecondarySidebar();
		await layouts.resizePanelToHeight(320);
		await sessions.resizeSessionList({ x: -180 });

		// capture screenshot
		await prepareForScreenshot(app, page);
		await overrideWorkspaceName(page, 'qa-example-content', 'my-project');
		await annotate(page, [
			{ selector: 'button:has(.top-action-bar-session-picker-face)', label: '', color: ANNOTATION_COLOR, padding: 2 },
		]);
		await captureFullWindow(page, 'active-interpreter-session.png');
	});
});
