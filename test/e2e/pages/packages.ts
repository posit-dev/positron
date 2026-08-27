/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, Locator } from '@playwright/test';
import { Code } from '../infra/code';
import { ContextMenu } from './dialog-contextMenu';
import { Help } from './help';
import { QuickInput } from './quickInput';
import { Toasts } from './dialog-toasts';

/*
 *  Reuseable Positron packages pane functionality for tests to leverage
 */
export class Packages {

	packagesButton: Locator;
	packagesContainer: Locator;
	refreshPackagesButton: Locator;
	packagesViewMoreActionsButton: Locator;
	filterButton: Locator;
	filterOptionsMenu: Locator;
	filterOptionsSubmenu: Locator;
	packageDetail: Locator;

	constructor(private code: Code, private contextMenu: ContextMenu, private quickInput: QuickInput, private toasts: Toasts, private help: Help) {
		this.packagesButton = this.code.driver.currentPage.locator('a.action-label.codicon-package');
		this.packagesContainer = this.code.driver.currentPage.locator('.positron-packages-list');

		this.refreshPackagesButton = this.code.driver.currentPage
			.getByRole('toolbar', { name: 'Packages actions' })
			.getByLabel('Refresh Packages');
		// More Actions button (overflow menu) in the packages view title bar
		this.packagesViewMoreActionsButton = code.driver.currentPage
			.getByRole('toolbar', { name: 'Packages actions' })
			.getByRole('button', { name: 'Views and More Actions...' });
		// Filter funnel that opens the Filter/Sort options menu.
		this.filterButton = this.packagesContainer.locator('.filter-button');
		// Custom context menu popups appear in DOM order. The first is the top-level
		// Filter/Sort menu; a hovered submenu trigger spawns a second popup.
		const popupItems = this.code.driver.currentPage
			.locator('.positron-modal-popup-container .custom-context-menu-items');
		this.filterOptionsMenu = popupItems.first();
		this.filterOptionsSubmenu = popupItems.nth(1);
		// The package editor's detail view. It opens in the editor area, not the
		// pane, so it hangs off the page rather than off `packagesContainer`.
		this.packageDetail = this.code.driver.currentPage.locator('.positron-package-detail');
	}

	/**
	 * Verifies the packages list is displayed with the expected version
	 * @param expectedVersion The expected version string to verify
	 */
	async verifyPackagesList(): Promise<void> {
		// Ensure packages pane is open
		await this.clickPackagesButton();

		// Clear any leftover filter from a prior test so the full list renders.
		// React filter state can persist across tests in the same file (shared app).
		await this.clearFilter();

		// Verify the packages list is displayed
		await expect(this.packagesContainer).toBeVisible();

		// Verify package list items are present
		const packageItems = this.packagesContainer.locator('.packages-list-item-name');
		await expect(packageItems.first()).toBeVisible();
		const itemCount = await packageItems.count();
		expect(itemCount).toBeGreaterThan(0);
	}

	/**
	 * Opens the packages pane if not already open and waits for the
	 * container to be visible.
	 */
	async clickPackagesButton(): Promise<void> {
		const isVisible = await this.packagesContainer.isVisible();
		if (!isVisible) {
			await this.packagesButton.click();
		}
		await expect(this.packagesContainer).toBeVisible();
	}

	/**
	 * Closes the packages pane if it's currently open
	 */
	async closePackagesPane(): Promise<void> {
		const isVisible = await this.packagesContainer.isVisible();
		if (isVisible) {
			await this.packagesButton.click();
		}
	}

	/**
	 * Types into the packages pane filter input to narrow the visible list.
	 * @param text The filter text to apply (pass '' to clear).
	 */
	async searchPackages(text: string): Promise<void> {
		await this.clickPackagesButton();
		await this.packagesContainer.getByPlaceholder('Filter packages').fill(text);
		await this.scrollListToTop();
	}

	/**
	 * Scrolls the packages list back to the top.
	 *
	 * Called after filtering because the list is a virtualized grid that tracks
	 * its own vertical offset, and that offset is not clamped when the row count
	 * shrinks (`PositronListInstance.setEntries` only fires an update; the clamp
	 * against `maximumVerticalScrollOffset` lives in `DataGridInstance.setSize`,
	 * which runs on resize). So a list scrolled even one row down -- which the
	 * post-install scroll-and-flash does on its own -- renders *zero* rows once a
	 * filter narrows it, because the render window sits past the new end of the
	 * content. Scrolling to the top first puts the offset somewhere always valid.
	 *
	 * A wheel event rather than setting `scrollTop`: the grid's offset is internal
	 * state, not the element's native scroll position.
	 */
	private async scrollListToTop(): Promise<void> {
		await this.packagesContainer.hover({ position: { x: 20, y: 100 } });
		await this.code.driver.currentPage.mouse.wheel(0, -20_000);
	}

	/**
	 * Clears the packages pane filter input. No-op if the pane isn't open.
	 */
	async clearFilter(): Promise<void> {
		if (await this.packagesContainer.isVisible()) {
			await this.packagesContainer.getByPlaceholder('Filter packages').fill('');
		}
	}

	/**
	 * Asserts the packages list has rendered at least one item. Use after
	 * starting a session to wait for the package provider's first snapshot.
	 */
	async expectPackagesListPopulated(): Promise<void> {
		await expect(
			this.packagesContainer.locator('.packages-list-item-name').first(),
		).toBeVisible();
	}

	/**
	 * Asserts that a package row is present in the currently filtered list.
	 * Retries past the post-install refresh delay (the install toast clears
	 * before the package provider re-emits its snapshot — R installs via pak
	 * can take ~30s on Windows CI before the package appears).
	 * @param name The exact package name to look for.
	 * @param timeout Max time to wait for the row to appear.
	 */
	async expectPackageInList(name: string, timeout = 60_000): Promise<void> {
		await this.clickPackagesButton();
		const row = this.packagesContainer.locator('.packages-list-item-name', { hasText: name });
		await expect(row.first()).toBeVisible({ timeout });
	}

	/**
	 * Asserts that a package row is absent from the currently filtered list.
	 * Retries past the post-uninstall refresh delay (the package provider
	 * re-emits its snapshot asynchronously — R uninstalls via pak can take
	 * tens of seconds before the row disappears).
	 * @param name The exact package name that should no longer appear.
	 * @param timeout Max time to wait for the row to disappear.
	 */
	async expectPackageNotInList(name: string, timeout = 60_000): Promise<void> {
		await this.clickPackagesButton();
		const row = this.packagesContainer.locator('.packages-list-item-name', { hasText: name });
		await expect(row).toHaveCount(0, { timeout });
	}

	/**
	 * Locates the external-link button on a package row.
	 * @param packageName The exact package name whose URL button to return.
	 */
	urlButton(packageName: string): Locator {
		return this.packagesContainer.getByRole('button', { name: `Open website for ${packageName}` });
	}

	/**
	 * Click the filter funnel to open the Filter/Sort options menu.
	 * Asserts the top-level menu is visible.
	 */
	async openFilterOptionsMenu(): Promise<void> {
		await this.clickPackagesButton();
		await this.filterButton.click();
		await expect(this.filterOptionsMenu).toBeVisible();
	}

	/**
	 * Hover the named submenu trigger (Filter or Sort) in the open filter options
	 * menu to reveal its nested submenu. Asserts the submenu is visible.
	 */
	async expandFilterOptionsSubmenu(name: 'Filter' | 'Sort'): Promise<void> {
		const trigger = this.filterOptionsMenu.locator('.custom-context-menu-item', {
			has: this.code.driver.currentPage.locator('.title', { hasText: name }),
		});
		await expect(trigger).toBeVisible();
		await trigger.hover();
		await expect(this.filterOptionsSubmenu).toBeVisible();
	}

	/**
	 * Hover an item in the currently-open filter options submenu so it shows
	 * the highlighted state. Used for screenshots that need to capture a
	 * specific item in the highlighted state.
	 */
	async hoverFilterOptionsSubmenuItem(label: string): Promise<void> {
		const item = this.filterOptionsSubmenu.locator('.custom-context-menu-item', {
			has: this.code.driver.currentPage.locator('.title', { hasText: label }),
		});
		await expect(item).toBeVisible();
		await item.hover();
	}

	/**
	 * Waits for the Help pane to render content for a package, retrying past the
	 * help-frame load delay.
	 * @param expectedText Substring that must appear in the help frame body
	 */
	async expectHelpPaneToContainText(expectedText: string): Promise<void> {
		await expect(async () => {
			const helpFrame = await this.help.getHelpFrame();
			await expect(helpFrame.locator('body')).toContainText(expectedText);
		}).toPass();
	}

	/**
	 * Clicks the help button on a package row to open its help topic in the Help pane.
	 * The packages list is virtualized -- scrolls the list down until the row for
	 * the requested package is rendered, then clicks its help button.
	 * @param packageName The name of the package whose help button should be clicked
	 */
	async clickHelpButton(packageName: string): Promise<void> {
		await this.clickPackagesButton();
		await expect(this.packagesContainer).toBeVisible();

		await this.searchPackages(packageName);
		const helpButton = this.packagesContainer.getByRole('button', { name: `Show help for ${packageName}`, exact: true });

		await helpButton.click();
		await this.clearFilter();
	}

	async clickRefreshPackagesButton(): Promise<void> {
		await this.clickPackagesButton();
		await this.refreshPackagesButton.click();
	}

	/**
	 * Installs a package using the Install Package action in the view title overflow menu
	 * @param packageName The name of the package to install (e.g., 'cowsay')
	 * @param options Optional parameters for installation
	 * @param options.version Specific version to install. If not provided, uses the first version in the list.
	 */
	async installPackage(packageName: string, options?: { version?: string }): Promise<void> {
		// Ensure packages pane is open
		await this.clickPackagesButton();

		// Click "Install Package" from the overflow menu
		await this.contextMenu.triggerAndClick({
			menuTrigger: this.packagesViewMoreActionsButton,
			menuItemLabel: 'Install Package',
			exact: true
		});

		// Wait for the quick input to appear
		await this.quickInput.waitForQuickInputOpened();

		// Type the package name and submit to trigger API search
		await this.quickInput.type(packageName);
		await this.quickInput.submitInputBox();

		// Wait for search results to load (API call)
		await this.quickInput.selectQuickInputElementExact(packageName);

		// Wait for version selection screen
		await this.quickInput.waitForQuickInputOpened();

		if (options?.version) {
			// Filter the version list down to the requested version, then click that
			// row. Submitting the input box instead would accept whichever row the
			// picker happens to have active, and the click below would then be left
			// waiting on a picker that has already closed.
			await this.quickInput.type(options.version);
			await this.quickInput.selectQuickInputElementExact(options.version);
		} else {
			// Accept the first item: the version list is sorted descending, so this
			// installs the newest version.
			await this.quickInput.selectQuickInputElement(0);
		}

		await this.quickInput.waitForQuickInputClosed();

		// Best-effort wait for the "Installing packages..." toast to appear and then
		// disappear, to settle before callers assert on the package list. A fast
		// install (e.g. `uv` installing a small wheel in milliseconds) can raise and
		// clear the toast before it is ever observed, so a missed toast is not a
		// failure -- `expectPackageInList` / `expectPackageNotInList` poll the list
		// with their own retries and are the real assertions.
		await this.toasts.waitForAppear('Installing packages...', { timeout: 30000 }).catch(() => { });
		await this.toasts.waitForDisappear('Installing packages...', { timeout: 60000 }).catch(() => { });
	}

	/**
	 * Uninstalls a package via the row's right-click context menu.
	 * Right-clicks the package row to open the context menu and clicks "Uninstall
	 * Package". The command normally shows a confirmation dialog, but under the
	 * smoke test driver `DialogService.confirm()` auto-confirms without rendering
	 * a dialog (see `skipDialogs()` in dialogService.ts), so there is nothing to
	 * click here -- the uninstall proceeds directly.
	 *
	 * Returns once the action is dispatched; use {@link expectPackageNotInList} to
	 * wait for the package to actually drop out of the list.
	 * @param packageName The name of the package to uninstall (e.g., 'cowsay')
	 */
	async uninstallPackage(packageName: string): Promise<void> {
		await this.clickPackagesButton();

		// Right-click the package row to open its context menu, then click "Uninstall Package".
		const row = this.packagesContainer.locator('.packages-list-item-name', { hasText: packageName });
		await this.contextMenu.triggerAndClick({
			menuTrigger: row.first(),
			menuItemLabel: 'Uninstall Package',
			menuTriggerButton: 'right',
			exact: true
		});
	}

	/**
	 * Locates a package's whole row in the currently filtered list, so callers can
	 * reach the badges that sit alongside the name rather than just the name cell.
	 * The list is virtualized, so filter down to the package first.
	 * @param packageName The exact package name whose row to return.
	 */
	private packageRow(packageName: string): Locator {
		return this.packagesContainer.locator('.packages-list-item', {
			// Anchored: a substring match would also accept 'bottleneck' when asked
			// for 'bottle'.
			has: this.code.driver.currentPage.locator('.packages-list-item-name', {
				hasText: new RegExp(`^${packageName}$`),
			}),
		}).first();
	}

	/**
	 * Locates the security advisory badge on a package row. Rendered only once
	 * Package Manager has reported advisories for the installed version, so use
	 * {@link expectVulnerabilityBadge} to wait for it.
	 * @param packageName The exact package name whose badge to return.
	 */
	vulnerabilityBadge(packageName: string): Locator {
		return this.packageRow(packageName).locator('.packages-list-item-vulnerable');
	}

	/**
	 * Filters the list to a package and asserts its row carries a security
	 * advisory badge for the expected advisory and severity. Asserts against the
	 * badge's accessible name, which names the worst advisory and either its CVSS
	 * score and band or -- for an advisory published without a score, as every
	 * CRAN advisory is -- "Severity unknown".
	 *
	 * The default timeout is generous: the badge appears when the pane's metadata
	 * stage completes, and that stage waits for the runtime's own outdated-version
	 * fetch alongside the Package Manager round trip (whose budget is
	 * `TOTAL_BUDGET_MS` in packageVulnerabilityLookup.ts) before it merges either
	 * one. So the badge lands well after the row does.
	 * @param packageName The exact package name whose badge to check.
	 * @param expected The advisory id the badge should lead with, and the severity
	 * band it should report ('unscored' for an advisory with no CVSS score).
	 * @param timeout Max time to wait for the advisory data to land.
	 */
	async expectVulnerabilityBadge(
		packageName: string,
		expected: { advisoryId: string; severity: 'Critical' | 'High' | 'Medium' | 'Low' | 'unscored' },
		timeout = 120_000,
	): Promise<void> {
		await this.searchPackages(packageName);
		// Assert the row before the badge. Both a missing row and a missing badge
		// fail the badge locator with "element(s) not found", and they have nothing
		// to do with each other: no row means the filter or the list is the problem,
		// no badge on a present row means the advisory data never arrived.
		await expect(this.packageRow(packageName)).toBeVisible({ timeout: 60_000 });
		const highest = expected.severity === 'unscored'
			? 'Severity unknown'
			// The score itself is deliberately loose: NVD rescores advisories, and
			// PPM can start reporting a newer CVSS revision for the same one.
			: `CVSS \\d+\\.\\d, ${expected.severity}`;
		await expect(this.vulnerabilityBadge(packageName)).toHaveAttribute(
			'aria-label',
			new RegExp(`Highest: ${expected.advisoryId} \\(${highest}\\)`),
			{ timeout },
		);
	}

	/**
	 * Opens a package's detail view by selecting its row, which opens the package
	 * editor as a preview tab. Filters the list to the package first, since the
	 * list is virtualized.
	 * @param packageName The exact package name to open.
	 */
	async openPackageDetail(packageName: string): Promise<void> {
		await this.searchPackages(packageName);
		// The list is a virtualized grid whose rows are recreated whenever a
		// refresh lands, and a freshly installed row also carries a transient
		// 'recently-changed' class. A single click loses the race ("element was
		// detached from the DOM"), so retry the click together with its outcome.
		await expect(async () => {
			await this.packageRow(packageName).click({ timeout: 5_000 });
			await expect(
				this.packageDetail.getByRole('heading', { name: packageName })
			).toBeVisible({ timeout: 5_000 });
		}).toPass({ timeout: 60_000 });
	}

	/**
	 * Selects the Security tab in the open package detail view. The tab is offered
	 * only when the runtime has advisory data for the package, so assert the row's
	 * badge first.
	 */
	async clickSecurityTab(): Promise<void> {
		// The tab's accessible name carries the advisory count ("Security, 1 known
		// vulnerability"), so match on the leading word.
		const tab = this.packageDetail.getByRole('tab', { name: /^Security/ });
		await tab.click();
		await expect(tab).toHaveAttribute('aria-selected', 'true');
	}

	/**
	 * Asserts an advisory is listed in the open package detail view. Matches the
	 * advisory's link, whose accessible name names the advisory.
	 * @param advisoryId The advisory id as displayed, e.g. 'CVE-2022-31799'.
	 */
	async expectAdvisoryListed(advisoryId: string): Promise<void> {
		await expect(
			this.packageDetail.getByRole('button', { name: `Open advisory ${advisoryId}` })
		).toBeVisible();
	}
}
