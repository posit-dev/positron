/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { ProjectType, } from '../../infra';
import { test, tags } from '../_test.setup';

test.use({
	suiteId: __filename
});

test.beforeEach(async function ({ app }) {
	await app.workbench.console.waitForReadyOrNoInterpreter();
	await app.workbench.layouts.enterLayout("stacked");
});

test.describe('R - New Project Wizard', { tag: [tags.NEW_PROJECT_WIZARD] }, () => {
	test.describe.configure({ mode: 'serial' });

	test('R - Project Defaults [C627913]', { tag: [tags.CRITICAL, tags.WIN] }, async function ({ app }) {
		const projectTitle = addRandomNumSuffix('r-defaults');

		await app.workbench.newProjectWizard.createNewProject({
			type: ProjectType.R_PROJECT,
			title: projectTitle
		});

		await verifyProjectCreation(app, projectTitle);
		// here, but it's timing out in CI, so it is not included for now.
	});

	test('R - Accept Renv install [C633084]', { tag: [tags.WIN] }, async function ({ app, r }) {
		const projectTitle = addRandomNumSuffix('r-installRenv');

		await app.workbench.newProjectWizard.createNewProject({
			type: ProjectType.R_PROJECT,
			title: projectTitle,
			rEnvCheckbox: true,
			// configure: {
			// 	renv: true
			// }
		});

		// If this test is running on a machine that is using Renv for the first time, we
		// may need to interact with the Console to allow the renv installation to complete
		// An example: https://github.com/posit-dev/positron/pull/3881#issuecomment-2211123610.

		// You should either manually interact with the Console to proceed with the Renv
		// install or temporarily uncomment the code below to automate the interaction.
		if (process.env.GITHUB_ACTIONS) {
			await app.workbench.popups.installRenv();
			await app.workbench.console.waitForConsoleContents('Do you want to proceed?');
			await app.workbench.console.typeToConsole('y');
			await app.workbench.console.sendEnterKey();
		}

		await verifyProjectCreation(app, projectTitle);
		await verifyRenvFilesArePresent(app);
		await app.workbench.console.waitForConsoleContents('renv activated');
	});

	test('R - Renv already installed [C656251]', { tag: [tags.WIN] }, async function ({ app }) {
		// Renv will already be installed from the previous test - which is why tests are marked as "serial"
		const projectTitle = addRandomNumSuffix('r-renvAlreadyInstalled');
		await app.workbench.newProjectWizard.createNewProject({
			type: ProjectType.R_PROJECT,
			title: projectTitle,
			rEnvCheckbox: true,
			// configure: {
			// 	renv: true
			// }
		});

		await verifyProjectCreation(app, projectTitle);
		await verifyRenvFilesArePresent(app);
		await app.workbench.console.waitForConsoleContents('renv activated');
	});

	test('R - Cancel Renv install [C656252]', { tag: [tags.WIN] }, async function ({ app }) {
		const projectTitle = addRandomNumSuffix('r-cancelRenvInstall');

		// Remove renv package so we are prompted to install it again
		await app.workbench.console.executeCode('R', 'remove.packages("renv")', '>');
		await app.workbench.console.waitForConsoleContents(`Removing package`);

		// Create a new R project - select Renv but opt out of installing
		await app.workbench.newProjectWizard.createNewProject({
			type: ProjectType.R_PROJECT,
			title: projectTitle,
			rEnvCheckbox: true,
		});

		// Interact with the modal to skip installing renv
		await app.workbench.popups.installRenv(false);

		await verifyProjectCreation(app, projectTitle);
		await verifyRenvFilesArePresent(app, false);
	});

});

test.describe('Jupyter - New Project Wizard', () => {
	test('Jupyter Project Defaults [C629352]', {
		tag: [tags.CRITICAL, tags.WIN],
	}, async function ({ app }) {
		const projectTitle = addRandomNumSuffix('jupyter-defaults');
		await app.workbench.newProjectWizard.createNewProject({
			type: ProjectType.JUPYTER_NOTEBOOK,
			title: projectTitle
		});

		await verifyProjectCreation(app, projectTitle);
	});
});

function addRandomNumSuffix(name: string): string {
	return `${name}_${Math.floor(Math.random() * 1000000)}`;
}

async function verifyProjectCreation(app: any, projectTitle: string) {
	await expect(app.code.driver.page.getByRole('button', { name: `Explorer Section: ${projectTitle}` })).toBeVisible({ timeout: 15000 });
	// await app.workbench.console.waitForReadyOrNoInterpreter();
}

async function verifyRenvFilesArePresent(app: any, renvFilesPresent = true) {
	await expect(async () => {
		const projectFiles = await app.workbench.explorer.getExplorerProjectFiles();

		if (renvFilesPresent) {
			// Verify that the renv files are present
			expect(projectFiles).toContain('renv');
			expect(projectFiles).toContain('.Rprofile');
			expect(projectFiles).toContain('renv.lock');
		} else {
			// Verify that the renv files are NOT present
			expect(projectFiles).not.toContain('renv');
			expect(projectFiles).not.toContain('.Rprofile');
			expect(projectFiles).not.toContain('renv.lock');
		}
	}).toPass({ timeout: 50000 });
}
