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
	tag: [tags.WEB, tags.CONSOLE, tags.WIN]
}, () => {

	test('R - Verify console link to help', async function ({ app, r }) {

		await app.workbench.console.pasteCodeToConsole("txt_formatted <- \"Help for a function: `\u001b]8;;x-r-help:utils::available.packages\\autils::available.packages\u001b]8;;\u0007()`\"", true);
		await app.workbench.console.pasteCodeToConsole('cat(txt_formatted)', true);

		await app.workbench.console.activeConsole.locator('span', { hasText: 'utils::available.packages' }).click();

		await expect((await app.workbench.help.getHelpFrame(0)).getByText('List Available Packages at CRAN-like Repositories')).toBeVisible({ timeout: 30000 });

	});


	test('R - Verify help with custom link text', async function ({ app, r }) {

		await app.workbench.console.pasteCodeToConsole('library(cli)', true);
		await app.workbench.console.pasteCodeToConsole('txt <- "Help for a function with custom text: {.help [CLICK HERE](utils::sessionInfo)}"', true);
		await app.workbench.console.pasteCodeToConsole('cli_text(txt)', true);

		await app.workbench.console.activeConsole.locator('span', { hasText: 'CLICK HERE' }).nth(2).click();

		await expect((await app.workbench.help.getHelpFrame(0)).getByText('Collect Information About the Current R Session')).toBeVisible({ timeout: 30000 });

	});

	test('R - Verify help for a topic that is not a function', async function ({ app, r }) {

		await app.workbench.console.pasteCodeToConsole('library(cli)', true);
		await app.workbench.console.pasteCodeToConsole('txt <- "Help for a non-function topic: {.topic utils::BATCH}"', true);
		await app.workbench.console.pasteCodeToConsole('cli_text(txt)', true);

		await app.workbench.console.activeConsole.locator('span', { hasText: 'utils::BATCH' }).nth(2).click();

		await expect((await app.workbench.help.getHelpFrame(0)).getByText('Batch Execution of R')).toBeVisible({ timeout: 30000 });

	});

	test('R - Verify help for a vignette', async function ({ app, r }) {

		await app.workbench.console.pasteCodeToConsole('library(cli)', true);
		await app.workbench.console.pasteCodeToConsole('txt <- "A vignette: {.vignette dplyr::dplyr}"', true);
		await app.workbench.console.pasteCodeToConsole('cli_text(txt)', true);

		await app.workbench.console.activeConsole.locator('span', { hasText: 'dplyr::dplyr' }).nth(3).click();

		await expect((await app.workbench.help.getHelpFrame(0)).getByText('Introduction to dplyr')).toBeVisible({ timeout: 30000 });

	});

	test('R - Verify automatically runnable code link', async function ({ app, r }) {

		await app.workbench.console.pasteCodeToConsole('library(cli)', true);
		await app.workbench.console.pasteCodeToConsole('txt <- "Is rlang installed? Run this to find out: {.run rlang::is_installed(\'rlang\')}"', true);
		await app.workbench.console.pasteCodeToConsole('cli_text(txt)', true);

		// Clicking automatically runs (rlang is an approved package)
		await app.workbench.console.activeConsole.locator('span', { hasText: 'rlang::is_installed(\'rlang\')' }).nth(2).click();

		await app.workbench.console.waitForConsoleContents('[1] TRUE', { timeout: 30000 });

	});

	test('R - Verify manually runnable code link', async function ({ app, r }) {

		await app.workbench.console.pasteCodeToConsole('library(cli)', true);
		await app.workbench.console.pasteCodeToConsole('txt <- "Is foofy alive? Run this to find out: {.run foofy::alive()}"', true);
		await app.workbench.console.pasteCodeToConsole('cli_text(txt)', true);

		// Clicking pastes to console (not safe to automatically run, but not known to be unsafe either)
		await app.workbench.console.activeConsole.locator('span', { hasText: 'foofy::alive()' }).nth(2).click();

		await app.workbench.console.waitForCurrentConsoleLineContents('foofy::alive()');
		await app.workbench.console.clearInput();

	});

	test('R - Verify not runnable code link', async function ({ app, r }) {

		await app.workbench.console.pasteCodeToConsole('library(cli)', true);
		await app.workbench.console.pasteCodeToConsole('txt <- "You can\'t click to run {.run utils::sessionInfo()}"', true);
		await app.workbench.console.pasteCodeToConsole('cli_text(txt)', true);

		// Clicking denies with toast message (base packages are unsafe)
		await app.workbench.console.activeConsole.locator('span', { hasText: 'utils::sessionInfo()' }).nth(3).click();

		await app.workbench.popups.toastLocator.locator('span', { hasText: 'Code hyperlink not recognized.' }).waitFor({ state: 'visible', timeout: 30000 });

	});

	test('R - Verify runnable code link for stringr', async function ({ app, r }) {

		await app.workbench.console.pasteCodeToConsole('library(stringr)', true);
		await app.workbench.console.pasteCodeToConsole('library(cli)', true);
		await app.workbench.console.pasteCodeToConsole('txt <- "This should work: {.run stringr::str_c(\'hello, \', \'world\')}"', true);
		await app.workbench.console.pasteCodeToConsole('cli_text(txt)', true);

		// Clicking automatically runs (loaded packages can automatically run)
		await app.workbench.console.activeConsole.locator('span', { hasText: 'stringr::str_c(\'hello, \', \'world\')' }).nth(2).click();

		await app.workbench.console.waitForConsoleContents('[1] "hello, world"', { timeout: 30000 });

	});

	test('R - Verify file hyperlink', {
		annotation: [{ type: 'issue', description: 'https://github.com/posit-dev/positron/issues/7256' }],
	}, async function ({ app, r }) {

		await app.workbench.console.pasteCodeToConsole('library(cli)', true);
		await app.workbench.console.pasteCodeToConsole('txt <- "Let\'s open a file {.file DESCRIPTION}"', true);
		await app.workbench.console.pasteCodeToConsole('cli_text(txt)', true);

		await app.workbench.console.activeConsole.locator('span', { hasText: 'DESCRIPTION' }).nth(3).click();

		await app.workbench.editor.waitForEditorContents('DESCRIPTION', (contents: string) => {
			return contents.includes('Package:') && contents.includes('Version:');
		});

	});

});
