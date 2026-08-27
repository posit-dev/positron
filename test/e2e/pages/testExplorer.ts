/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, Locator } from '@playwright/test';
import { Explorer } from './explorer';

const TEST_EXPLORER_ICON = '.composite-bar .codicon-test-view-icon';

// Codicon classes on a test row's `.computed-state` icon, per result state. The icon
// tracks transient states (Queued/Running) live, unlike the aria-label. Running is a
// generic spinner; the rest are testing-specific icons.
const STATE_ICON_CLASS = {
	Unset: 'codicon-testing-unset-icon',
	Queued: 'codicon-testing-queued-icon',
	Running: 'codicon-modifier-spin',
	Passed: 'codicon-testing-passed-icon',
	Failed: 'codicon-testing-failed-icon',
	Errored: 'codicon-testing-error-icon',
	Skipped: 'codicon-testing-skipped-icon',
} as const;

/*
 *  Reuseable Positron test explorer functionality for tests to leverage.
 */
export class TestExplorer extends Explorer {

	async openTestExplorer(): Promise<void> {
		// The view container's activity-bar icon appears once test discovery has
		// populated it; wait for that before focusing, or the command no-ops.
		await this.code.driver.currentPage.locator(TEST_EXPLORER_ICON).waitFor({ state: 'visible' });
		await this.quickaccess.runCommand('workbench.view.testing.focus');
	}

	async collapseAllTests(): Promise<void> {
		await this.quickaccess.runCommand('testing.collapseAll');
	}

	async clearAllTestResults(): Promise<void> {
		await this.quickaccess.runCommand('testing.clearTestResults');
	}

	async cancelTestRun(): Promise<void> {
		await this.quickaccess.runCommand('testing.cancelRun');
	}

	async expectTestItems(labels: string[], timeout?: number): Promise<void> {
		const tree = this.code.driver.currentPage.locator('.test-explorer');
		for (const label of labels) {
			await expect(tree.getByLabel(label)).toBeVisible({ timeout });
		}
	}

	async expectNoTestItem(label: string, timeout?: number): Promise<void> {
		const tree = this.code.driver.currentPage.locator('.test-explorer');
		await expect(tree.getByLabel(label)).toHaveCount(0, { timeout });
	}

	async runAllTests(): Promise<void> {
		await this.code.driver.currentPage.locator('.composite.title').getByLabel('Run Tests', { exact: true }).click();
	}

	async runTest(label: string): Promise<void> {
		const tree = this.code.driver.currentPage.locator('.test-explorer');
		const row = tree.locator('.monaco-list-row', { hasText: label });
		// Addressing a row by label only works once it is rendered; see revealTestItem.
		await this.revealTestItem(row);
		await row.hover();
		await row.getByLabel('Run Test', { exact: true }).click();
	}

	/**
	 * Expands one test item, revealing it first. Allows us to expand, e.g., a
	 * specific test file and worry less about un-realized test items.
	 *
	 * @param recurse Also expand the descendants, for an item whose tests nest --
	 *   a `describe()` holding `it()` calls, say. Items deeper than this one can
	 *   only be its descendants, because the other files stay collapsed.
	 */
	async expandTest(label: string, { recurse = false } = {}): Promise<void> {
		const tree = this.code.driver.currentPage.locator('.test-explorer');
		const row = tree.locator('.monaco-list-row', { hasText: label }).first();
		await this.revealTestItem(row);
		await this.expandRow(row);

		if (!recurse) {
			return;
		}

		const parentLevel = Number(await row.getAttribute('aria-level'));
		// FWIW a depth of 2 is all we currently need in practice and I believe
		// that to be true of most real-world usage as well.
		const MAX_DEPTH = 5;
		for (let childLevel = parentLevel + 1; childLevel <= parentLevel + MAX_DEPTH; childLevel++) {
			const collapsedChildren = tree.locator(`.monaco-list-row[aria-expanded="false"][aria-level="${childLevel}"]`);
			let remaining = await collapsedChildren.count();
			// Deeper generations only exist once these are expanded.
			if (remaining === 0) {
				break;
			}
			while (remaining > 0) {
				await this.expandRow(collapsedChildren.first());
				const left = await collapsedChildren.count();
				// Give up if a click made no difference, rather than spinning.
				if (left >= remaining) {
					break;
				}
				remaining = left;
			}
		}
	}

	private async expandRow(row: Locator): Promise<void> {
		if (await row.getAttribute('aria-expanded') === 'false') {
			await row.locator('.monaco-tl-twistie').click();
		}
	}

	// State is encoded in the accessible label as "<label> (<state>)"; substring match ignores the trailing ", in <duration>".
	async expectTestStatus(label: string, state: 'Passed' | 'Failed' | 'Errored' | 'Skipped', timeout?: number): Promise<void> {
		const tree = this.code.driver.currentPage.locator('.test-explorer');
		const target = tree.getByLabel(`${label} (${state})`);

		// Reveal before asserting: the tree is virtualized, so a row outside the
		// rendered range is absent from the DOM and would never become visible no
		// matter how long we wait. Retry the whole reveal-and-assert, since early
		// attempts can run while the test is still queued.
		await expect(async () => {
			await this.revealTestItem(target);
			await expect(target).toBeVisible({ timeout: 1000 });
		}).toPass({ timeout: timeout ?? 15000 });
	}

	/**
	 * Scrolls the test tree until the given row is rendered, or gives up. Resets to
	 * the top first, so the scan is deterministic regardless of where the tree was
	 * left. A no-op when the row is already rendered.
	 */
	private async revealTestItem(row: Locator): Promise<void> {
		if (await row.count() > 0) {
			return;
		}
		const page = this.code.driver.currentPage;
		await page.locator('.test-explorer').hover();
		await page.mouse.wheel(0, -100000);
		for (let i = 0; i < 60 && await row.count() === 0; i++) {
			await page.mouse.wheel(0, 200);
		}
	}

	async expectTestIcon(label: string, state: keyof typeof STATE_ICON_CLASS, timeout?: number): Promise<void> {
		const tree = this.code.driver.currentPage.locator('.test-explorer');
		const row = tree.locator('.monaco-list-row', { hasText: label });
		await expect(row.locator('.computed-state')).toHaveClass(new RegExp(STATE_ICON_CLASS[state]), { timeout });
	}
}
