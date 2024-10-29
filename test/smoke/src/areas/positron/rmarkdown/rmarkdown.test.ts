/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Application, PositronRFixtures } from '../../../../../automation';
import { join } from 'path';
import { expect } from '@playwright/test';
import { setupAndStartApp } from '../../../test-runner/test-hooks';


describe('RMarkdown #web', () => {
	setupAndStartApp();

	before(async function () {
		// Executes once before executing all tests.
		await PositronRFixtures.SetupFixtures(this.app as Application);
	});

	it('Render RMarkdown [C680618]', async function () {
		const app = this.app as Application; //Get handle to application
		await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'basic-rmd-file', 'basicRmd.rmd'));

		// Sometimes running render too quickly fails, saying pandoc is not installed.
		// Using expect.toPass allows it to retry.
		await expect(async () => {
			await app.workbench.quickaccess.runCommand('r.rmarkdownRender');
			await app.workbench.terminal.waitForTerminalText(buffer => buffer.some(line => line.startsWith('Output created: basicRmd.html')));
		}).toPass({ timeout: 80000 });

		// Wrapped in expect.toPass to allow UI to update/render
		await expect(async () => {
			const projectFiles = await app.workbench.positronExplorer.getExplorerProjectFiles();
			expect(projectFiles).toContain('basicRmd.html');
		}).toPass({ timeout: 80000 });

	});

	// test depends on the previous test
	it('Preview RMarkdown [C709147]', async function () {
		const app = this.app as Application; //Get handle to application

		// Preview
		await app.code.dispatchKeybinding(process.platform === 'darwin' ? 'cmd+shift+k' : 'ctrl+shift+k');

		// inner most frame has no useful identifying features
		// not factoring this locator because its not part of positron
		const gettingStarted = app.workbench.positronViewer.getViewerFrame().frameLocator('iframe').locator('h2[data-anchor-id="getting-started"]');

		await expect(gettingStarted).toBeVisible({ timeout: 30000 });
		await expect(gettingStarted).toHaveText('Getting started');
	});
});
