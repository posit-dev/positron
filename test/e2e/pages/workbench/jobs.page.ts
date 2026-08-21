/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import test, { expect, FrameLocator, Locator } from '@playwright/test';
import { Code } from '../../infra/code.js';
import { QuickAccess } from '../quickaccess.js';

/**
 * Status labels the Workbench Jobs tree renders for a job. The extension labels the job row with
 * the launcher status, except for a finished job, which it relabels "Succeeded" or "Failed" based
 * on the exit code.
 */
export type WorkbenchJobStatus = 'Pending' | 'Running' | 'Succeeded' | 'Failed';

/**
 * The Workbench Jobs view (contributed by the rstudio.rstudio-workbench extension) and the
 * "Run Workbench Job" launcher editor it opens.
 *
 * The launcher is a webview whose Script/Working Directory fields are read-only divs populated by
 * the extension -- they can't be typed into. The extension seeds the Script field from the active
 * editor, so the flow is: open the script, then open the launcher.
 */
export class JobsPage {
	private get page() { return this.code.driver.currentPage; }

	// Workbench Jobs view. While no job has been launched the pane renders its welcome content in
	// place of the tree, so the section header -- not the tree -- is what says the view is open.
	get activityBarIcon(): Locator { return this.page.locator('.activitybar').getByRole('tab', { name: 'Posit Workbench' }); }
	get jobsSection(): Locator { return this.page.getByRole('button', { name: 'Workbench Jobs Section' }); }
	get jobsTree(): Locator { return this.page.getByRole('tree', { name: 'Workbench Jobs' }); }
	get runJobWelcomeButton(): Locator { return this.page.getByRole('button', { name: 'Run Job', exact: true }); }

	// Run Workbench Job launcher (webview)
	get launcherFrame(): FrameLocator { return this.page.frameLocator('iframe.webview.ready').frameLocator('iframe#active-frame'); }
	get scriptPath(): Locator { return this.launcherFrame.locator('#launcher-script-path'); }
	get workingDirectory(): Locator { return this.launcherFrame.locator('#launcher-workdir-path'); }
	get jobName(): Locator { return this.launcherFrame.locator('#rstudio_label_job_name'); }
	get startButton(): Locator { return this.launcherFrame.locator('#submit'); }

	/**
	 * The job rows in the tree. Level 1 rows are the scripts and level 2 rows are their jobs, which
	 * the extension labels with the job's status rather than its name.
	 */
	get jobRows(): Locator { return this.jobsTree.locator('[role="treeitem"][aria-level="2"]'); }

	/**
	 * The row for the most recently submitted job. The extension sorts a script's jobs by
	 * submission time descending, so this is the job the test just started -- matching on the
	 * status label alone would also match a completed job left over from an earlier run.
	 */
	get latestJobRow(): Locator { return this.jobRows.first(); }

	constructor(private code: Code, private quickaccess: QuickAccess) { }

	// #region Actions

	/**
	 * Open the Posit Workbench view container from the activity bar. No-op when it is already the
	 * active container, since clicking the icon again would collapse the side bar.
	 */
	async openView(): Promise<void> {
		await test.step('Open Posit Workbench view', async () => {
			if (!await this.jobsSection.isVisible()) {
				await this.activityBarIcon.click();
			}
			await expect(this.jobsSection).toBeVisible();
		});
	}

	/**
	 * Open the "Run Workbench Job" launcher editor.
	 *
	 * Uses the view's welcome "Run Job" button, which is only rendered while the tree is empty; a
	 * session that has already run a job replaces the welcome content with the job list, so fall
	 * back to the command the view's title action runs.
	 */
	async openLauncher(): Promise<void> {
		await test.step('Open Run Workbench Job launcher', async () => {
			if (await this.runJobWelcomeButton.isVisible()) {
				await this.runJobWelcomeButton.click();
			} else {
				await this.quickaccess.runCommand('workbenchJobs.run');
			}
			await expect(this.startButton).toBeVisible();
		});
	}

	/**
	 * Submit the job from the launcher. The Start button carries a `disabled` class until the
	 * launcher has a job name and a script with a supported extension, so wait it out rather than
	 * clicking into a no-op click handler.
	 */
	async startJob(): Promise<void> {
		await test.step('Start Workbench job', async () => {
			await expect(this.startButton).not.toHaveClass(/disabled/);
			await this.startButton.click();
		});
	}

	/**
	 * Open the job's output channel via the tree row's inline "View Workbench Job" action. The
	 * extension creates the channel on demand, so there is no channel to pick until this runs, and
	 * the row's action bar only renders while the row is hovered.
	 */
	async openJobOutput(): Promise<void> {
		await test.step('Open Workbench job output', async () => {
			await this.latestJobRow.hover();
			await this.latestJobRow.getByRole('button', { name: 'View Workbench Job' }).click();
		});
	}

	// #endregion

	// #region Verifications

	/**
	 * Verify the launcher opened seeded from the active editor: the script path, the job name it
	 * derives from the script, and the working directory the extension resolves for the script.
	 */
	async expectLauncherToBeSeededWith(scriptName: string): Promise<void> {
		await test.step(`Verify launcher is seeded with: ${scriptName}`, async () => {
			await expect(this.scriptPath).toContainText(scriptName);
			await expect(this.jobName).toHaveValue(scriptName.replace(/\.[^.]+$/, ''));
			await expect(this.workingDirectory).not.toBeEmpty();
		});
	}

	/**
	 * Verify the Workbench Jobs tree lists the script and that its most recent job is in the given
	 * state.
	 */
	async expectJobStatus(scriptName: string, status: WorkbenchJobStatus, timeout = 15000): Promise<void> {
		await test.step(`Verify job for ${scriptName} is ${status}`, async () => {
			await expect(this.jobsTree.getByRole('treeitem', { name: scriptName })).toBeVisible({ timeout });
			await expect(this.latestJobRow).toContainText(status, { timeout });
		});
	}

	// #endregion
}
