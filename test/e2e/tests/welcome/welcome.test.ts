/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application, availableRuntimes } from '../../infra';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

type RunCommand = (commandId: string, options?: { keepOpen?: boolean; exactLabelMatch?: boolean }) => Promise<void>;

/**
 * Open a walkthrough from the command palette, which switches the editor to the
 * details slide and leaves the welcome page off-screen behind it.
 *
 * `keepOpen` stops runCommand from re-clicking until the picker closes: this
 * command opens a second picker of its own, and that retry loop would dismiss it
 * before the test could use it. Filter before selecting, because the list is
 * virtualized and an unfiltered match can sit in the DOM scrolled out of view.
 */
async function openWalkthrough(app: Application, runCommand: RunCommand) {
	const { quickInput } = app.workbench;

	await runCommand('welcome.showAllWalkthroughs', { keepOpen: true });
	await quickInput.waitForQuickInputOpened({ timeout: 30000 });
	await quickInput.type('Migrating from VSCode');
	await quickInput.selectQuickInputElementContaining('Migrating from VSCode to Positron');
}

test.describe('Welcome Page', { tag: [tags.WELCOME, tags.WEB] }, () => {
	test.afterEach(async function ({ hotKeys }) {
		await hotKeys.closeAllEditors();
	});

	test.describe('Workspace', () => {
		test.beforeEach(async function ({ hotKeys, sessions }) {
			await sessions.expectNoStartUpMessaging();
			await hotKeys.openWelcomeWalkthrough();
		});

		test('Verify page header, footer, content', async function ({ app }) {
			const { welcome } = app.workbench;

			await welcome.expectLogoToBeVisible();
			await welcome.expectFooterToBeVisible();
			await welcome.expectTabTitleToBe('Welcome');
			await welcome.expectStartToContain(['New Notebook', 'New File']);
			await welcome.expectHelpToContain(['Positron Documentation', 'Positron Community Forum', 'Report a Bug', 'Sign Up for Positron Updates']);
			await welcome.expectRecentToBeVisible();
			app.web
				? await welcome.expectConnectToBeVisible(false)
				: await welcome.expectConnectToBeVisible(true);
		});

		test('Verify limited walkthroughs on Welcome page and full list in `More...`', async function ({ app, hotKeys }) {
			const { welcome, quickInput } = app.workbench;
			await hotKeys.resetWelcomeWalkthrough();
			await hotKeys.reloadWindow(true);

			await welcome.expectWalkthroughsToHaveCount(3);
			await welcome.expectWalkthroughsToContain(['Migrating from VSCode to Positron', 'Migrating from RStudio to Positron', 'Jupyter Notebooks in Positron']);

			await welcome.walkthroughSection.getByText('More...').click();
			await quickInput.expectTitleBarToHaveText('Open Walkthrough...');
			await quickInput.expectQuickInputResultsToContain([
				'Get Started with Python Development',
				'Migrating from VSCode to Positron',
				'Migrating from RStudio to Positron',
				'Get Started with Jupyter Notebooks',
				'Get Started with Posit Publisher',
				'Jupyter Notebooks in Positron'
			]);
		});

		test('Verify Tab does not reach the welcome page while a walkthrough is open', async function ({ app, runCommand }) {
			const { welcome } = app.workbench;

			await openWalkthrough(app, runCommand);
			await welcome.expectHiddenSlideToBeInert('welcome');
		});

		test('Python - Verify clicking on `new notebook` from the Welcome page opens notebook and sets kernel', async function ({ app, python }) {
			const { welcome, popups, editors, notebooksPositron } = app.workbench;

			await welcome.newNotebookButton.click();
			await popups.clickItem('Python Notebook');
			await editors.expectActiveEditorIconClassToMatch(/ipynb-ext-file-icon/);
			await notebooksPositron.kernel.expectBadgeToContain(availableRuntimes['python'].name);
		});

		test('Python - Verify clicking on `new file` from the Welcome page opens editor', async function ({ app, python }) {
			const { welcome, quickInput, editors } = app.workbench;

			await welcome.newFileButton.click();
			await quickInput.selectQuickInputElementContaining('Python File');
			await editors.expectActiveEditorIconClassToMatch(/python-lang-file-icon/);
		});

		test('R - Verify clicking on `new notebook` from the Welcome page opens notebook and sets kernel', async function ({ app, sessions, r }) {
			const { welcome, popups, editors, notebooksPositron } = app.workbench;

			await welcome.newNotebookButton.click();
			await popups.clickItem('R Notebook');

			await editors.expectActiveEditorIconClassToMatch(/ipynb-ext-file-icon/);
			// Verify the Positron notebook editor's kernel badge shows the R runtime.
			await notebooksPositron.kernel.expectBadgeToContain(availableRuntimes['r'].name);
			await sessions.deleteAll();
		});

		test('R - Verify clicking on `new file` from the Welcome page opens editor', async function ({ app, r }) {
			const { welcome, quickInput, editors } = app.workbench;

			await welcome.newFileButton.click();
			await quickInput.selectQuickInputElementContaining('R File');
			await editors.expectActiveEditorIconClassToMatch(/r-lang-file-icon/);
		});
	});

	test.describe('No Workspace', () => {
		test.beforeEach(async function ({ hotKeys, sessions }) {
			await hotKeys.closeWorkspace();
			await sessions.expectSessionPickerToBe('Start Session');
			await sessions.expectNoStartUpMessaging();
			await hotKeys.openWelcomeWalkthrough();
		});

		test('Verify page header, footer, content', async function ({ app }) {
			const { welcome } = app.workbench;

			await welcome.expectLogoToBeVisible();
			await welcome.expectFooterToBeVisible();

			await welcome.expectStartToContain(['Open Folder...', 'New Folder...', 'New from Git...']);
			await welcome.expectHelpToContain(['Positron Documentation', 'Positron Community Forum', 'Report a Bug', 'Sign Up for Positron Updates']);
			await welcome.expectRecentToBeVisible();
		});

		test('Verify clicking on `Open Folder` opens file browser', { tag: [tags.WEB_ONLY] }, async function ({ app, page }) {
			const { welcome, quickInput } = app.workbench;

			await welcome.openFolderButton.click();
			await quickInput.expectTitleBarToHaveText('Open Folder');
		});

		test('Verify clicking on `New Folder` opens New Folder Flow', { tag: [tags.NEW_FOLDER_FLOW] }, async function ({ app }) {
			const { welcome, newFolderFlow } = app.workbench;

			await welcome.newFolderFromTemplateButton.click();
			await newFolderFlow.expectFolderTemplatesToBeVisible({
				'Empty Project': true,
				'Python Project': true,
				'R Project': true,
				'Jupyter Notebook': true
			});
		});

		test('Verify clicking on `New from Git` opens dialog', { tag: [tags.MODAL] }, async function ({ app }) {
			const { welcome, modals } = app.workbench;

			await welcome.startButtons.getByText('New from Git...').click();
			await modals.expectToBeVisible('New Folder from Git');
		});
	});
});
