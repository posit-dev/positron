/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.describe('Console Pane: R Hyperlinks', {
	tag: [tags.WEB, tags.CONSOLE, tags.WIN, tags.ARK]
}, () => {

	test('R - Verify console link to help', async function ({ app, r }) {
		const { console, help } = app.positron;

		await console.pasteCodeToConsole("txt_formatted <- \"Help for a function: `\u001b]8;;x-r-help:utils::available.packages\\autils::available.packages\u001b]8;;\u0007()`\"", true);
		await console.pasteCodeToConsole('cat(txt_formatted)', true);

		await console.activeConsole.locator('span', { hasText: 'utils::available.packages' }).click();

		await expect((await help.getHelpFrame(0)).getByText('List Available Packages at CRAN-like Repositories')).toBeVisible({ timeout: 30000 });
	});


	test('R - Verify help with custom link text', async function ({ app, r }) {
		const { console, help } = app.positron;

		await console.pasteCodeToConsole('library(cli)', true);
		await console.pasteCodeToConsole('txt <- "Help for a function with custom text: {.help [CLICK HERE](utils::sessionInfo)}"', true);
		await console.pasteCodeToConsole('cli_text(txt)', true);

		await console.activeConsole.locator('span', { hasText: 'CLICK HERE' }).nth(2).click();

		await expect((await help.getHelpFrame(0)).getByText('Collect Information About the Current R Session')).toBeVisible({ timeout: 30000 });
	});

	test('R - Verify help for a topic that is not a function', async function ({ app, r }) {
		const { console, help } = app.positron;

		await console.pasteCodeToConsole('library(cli)', true);
		await console.pasteCodeToConsole('txt <- "Help for a non-function topic: {.topic utils::BATCH}"', true);
		await console.pasteCodeToConsole('cli_text(txt)', true);

		await console.activeConsole.locator('span', { hasText: 'utils::BATCH' }).nth(2).click();

		await expect((await help.getHelpFrame(0)).getByText('Batch Execution of R')).toBeVisible({ timeout: 30000 });
	});

	test('R - Verify help for a vignette', async function ({ app, r }) {
		const { console, help } = app.positron;

		await console.pasteCodeToConsole('library(cli)', true);
		await console.pasteCodeToConsole('txt <- "A vignette: {.vignette dplyr::dplyr}"', true);
		await console.pasteCodeToConsole('cli_text(txt)', true);

		await console.activeConsole.locator('span', { hasText: 'dplyr::dplyr' }).nth(3).click();

		await expect((await help.getHelpFrame(0)).getByText('Introduction to dplyr')).toBeVisible({ timeout: 30000 });
	});

	test('R - Verify automatically runnable code link', async function ({ app, r }) {
		const { console } = app.positron;

		await console.pasteCodeToConsole('library(cli)', true);
		await console.pasteCodeToConsole('txt <- "Is rlang installed? Run this to find out: {.run rlang::is_installed(\'rlang\')}"', true);
		await console.pasteCodeToConsole('cli_text(txt)', true);

		// Clicking automatically runs (rlang is an approved package)
		await console.activeConsole.locator('span', { hasText: 'rlang::is_installed(\'rlang\')' }).nth(2).click();
		await console.waitForConsoleContents('[1] TRUE', { timeout: 30000 });

	});

	test('R - Verify manually runnable code link', async function ({ app, r }) {
		const { console } = app.positron;

		await console.pasteCodeToConsole('library(cli)', true);
		await console.pasteCodeToConsole('txt <- "Is foofy alive? Run this to find out: {.run foofy::alive()}"', true);
		await console.pasteCodeToConsole('cli_text(txt)', true);

		// Clicking pastes to console (not safe to automatically run, but not known to be unsafe either)
		await console.activeConsole.locator('span', { hasText: 'foofy::alive()' }).nth(2).click();

		await console.waitForCurrentConsoleLineContents('foofy::alive()');
		await console.clearInput();
	});

	test('R - Verify not runnable code link', async function ({ app, r }) {
		const { console, toasts } = app.positron;

		await console.pasteCodeToConsole('library(cli)', true);
		await console.pasteCodeToConsole('txt <- "You can\'t click to run {.run utils::sessionInfo()}"', true);
		await console.pasteCodeToConsole('cli_text(txt)', true);

		// Clicking denies with toast message (base packages are unsafe)
		await console.activeConsole.locator('span', { hasText: 'utils::sessionInfo()' }).nth(3).click();
		await toasts.expectToBeVisible('Code hyperlink not recognized.');
	});

	test('R - Verify runnable code link for stringr', async function ({ app, r }) {
		const { console } = app.positron;

		await console.pasteCodeToConsole('library(stringr)', true);
		await console.pasteCodeToConsole('library(cli)', true);
		await console.pasteCodeToConsole('txt <- "This should work: {.run stringr::str_c(\'hello, \', \'world\')}"', true);
		await console.pasteCodeToConsole('cli_text(txt)', true);

		// Clicking automatically runs (loaded packages can automatically run)
		await console.activeConsole.locator('span', { hasText: 'stringr::str_c(\'hello, \', \'world\')' }).nth(2).click();
		await console.waitForConsoleContents('[1] "hello, world"', { timeout: 30000 });
	});

	test('R - Verify file hyperlink', async function ({ app, r }) {
		const { console, editor } = app.positron;

		await console.pasteCodeToConsole('library(cli)', true);
		await console.pasteCodeToConsole('txt <- "Let\'s open a file {.file DESCRIPTION}"', true);
		await console.pasteCodeToConsole('cli_text(txt)', true);

		await console.activeConsole.locator('span', { hasText: 'DESCRIPTION' }).nth(3).click();

		await editor.waitForEditorContents('DESCRIPTION', (contents: string) => {
			return contents.includes('Package:') && contents.includes('Version:');
		});

	});

	test('R - Verify file hyperlink with line offset', async function ({ app, r, hotKeys }) {
		const { console, editor } = app.positron;
		await hotKeys.closeAllEditors();

		await console.clearButton.click();

		await console.pasteCodeToConsole('library(cli)', true);
		await console.pasteCodeToConsole('txt <- "Let\'s open a file {.file static-test-data-files/lineCount.txt:8}"', true);
		await console.pasteCodeToConsole('cli_text(txt)', true);

		await console.activeConsole.locator('.output-run-hyperlink span', { hasText: 'lineCount.txt' }).click();

		await editor.waitForEditorContents('lineCount.txt', (contents: string) => {
			const normalizedContents = contents.replace(/\s+/g, ' ').trim();
			return normalizedContents.includes('eight');
		});

		const cursorTopValue = await app.code.driver.page.locator('.editor .cursor').evaluate((element) => {
			return window.getComputedStyle(element).getPropertyValue('top');
		});

		const lineEightTopValue = await app.code.driver.page.locator('div.view-line', { hasText: /^eight$/ }).evaluate((element) => {
			return window.getComputedStyle(element).getPropertyValue('top');
		});

		expect(cursorTopValue).toBe(lineEightTopValue);

	});

});
