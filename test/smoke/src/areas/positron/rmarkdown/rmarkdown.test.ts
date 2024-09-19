/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Note - these paths will need to change for your specific test location
import { Application, Logger, PositronRFixtures } from '../../../../../automation';
import { installAllHandlers } from '../../../utils';
import { join } from 'path';
import { expect } from '@playwright/test';

export function setup(logger: Logger) {
	describe('RMarkdown', () => {
		// All Tests blocks inside this 'describe' block will use the same app instance
		// Shared before/after handling
		installAllHandlers(logger);


		before(async function () {
			// Executes once before executing all tests.
			await PositronRFixtures.SetupFixtures(this.app as Application);
		});

		it('Render RMarkdown [C680618] #pr', async function () {
			const app = this.app as Application; //Get handle to application
			await app.workbench.quickaccess.openFile(join(app.workspacePathOrFolder, 'workspaces', 'basic-rmd-file', 'basicRmd.rmd'));

			// Sometimes running render too quickly fails, saying pandoc is not installed.
			// Using expect.toPass allows it to retry.
			await expect(async () => {
				await app.workbench.quickaccess.runCommand('r.rmarkdownRender');
				await app.workbench.terminal.waitForTerminalText(buffer => buffer.some(line => line.startsWith('Output created: basicRmd.html')));
			}).toPass({ timeout: 50000 });

			// Wrapped in expect.toPass to allow UI to update/render
			await expect(async () => {
				const projectFiles = await app.workbench.positronExplorer.getExplorerProjectFiles();
				expect(projectFiles).toContain('basicRmd.html');
			}).toPass({ timeout: 50000 });

		});

		// test depends on the previous test
		// skipping this test for now.  need to determine what to do about the dialog that is appearing in CI
		it('Preview RMarkdown [C709147] #pr', async function () {
			const app = this.app as Application; //Get handle to application

			// Preview
			await app.code.dispatchKeybinding(process.platform === 'darwin' ? 'cmd+shift+k' : 'ctrl+shift+k');

			// inner most frame has no useful identifying features
			// not factoring this locator because its not part of positron
			const viewerFrame = app.workbench.positronViewer.getViewerFrame('//iframe');

			// not factoring this locator because its not part of positron
			const gettingStarted = viewerFrame.locator('h2[data-anchor-id="getting-started"]');

			const gettingStartedText = await gettingStarted.innerText();

			expect(gettingStartedText).toBe('Getting started');

			await app.workbench.positronTerminal.sendKeysToTerminal('Control+C');

		});
	});
}
