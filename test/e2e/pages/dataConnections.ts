/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import test, { expect, Locator } from '@playwright/test';
import { Code } from '../infra/code';
import { QuickAccess } from './quickaccess';

// The focus command for the Data Connections view (gated behind `dataConnections.enabled`).
const DATA_CONNECTIONS_VIEW_FOCUS_COMMAND = 'workbench.panel.positronDataConnections.focus';

// The "Add Data Connection" -> "Configure Data Connection" dialog and its surrounding modal.
const MODAL_DIALOG = '.positron-modal-dialog';
const PARAMETER_FIELD = '.parameter-field';
const DATA_CONNECTION_ENTRY_ROW = '.data-connection-entry-row';

// Tree row selectors. The tree renders inside a virtualized data grid; each row exposes a twisty
// button (aria-label "Expand" when collapsed) and a content area holding the node label.
const TREE_ROW = '.positron-tree-row';
const TREE_TWISTY_COLLAPSED = '.positron-tree-twisty-collapsed';

// The container that hosts the connection tree, and the virtualized grid inside it. The grid renders
// only the rows that fit in the viewport (no overscan), so rows below the fold are absent from the
// DOM until scrolled into view.
const TREE_CONTAINER = '#data-connection-profiles-list';
const TREE_WAFFLE = `${TREE_CONTAINER} .data-grid-waffle`;

// Version (pin bundle) nodes render with the history codicon; the active bundle carries an "active"
// type badge. Scoped to the tree container so the icon can't collide with history icons elsewhere in
// the workbench.
const VERSION_ROW = `${TREE_CONTAINER} ${TREE_ROW}:has(.codicon-history)`;
const NODE_TYPE_BADGE = '.data-connection-node-type';

/**
 * Reusable Positron Data Connections panel functionality for tests to leverage.
 *
 * Covers the panel gated behind the `dataConnections.enabled` setting: opening the view, adding a
 * connection through the new-connection flow (select provider -> configure -> save), and asserting
 * the resulting profile shows up in the tree.
 */
export class DataConnections {

	addConnectionButton: Locator;
	dialog: Locator;
	saveButton: Locator;
	nextButton: Locator;
	connectionEntries: Locator;

	constructor(private code: Code, private quickaccess: QuickAccess) {
		const page = code.driver.currentPage;
		this.addConnectionButton = page.locator('.codicon-positron-add-connection');
		this.dialog = page.locator(MODAL_DIALOG);
		this.saveButton = this.dialog.getByRole('button', { name: 'Save' });
		this.nextButton = this.dialog.getByRole('button', { name: 'Next' });
		this.connectionEntries = page.locator(DATA_CONNECTION_ENTRY_ROW);
	}

	/**
	 * Focuses the Data Connections view. Requires `dataConnections.enabled` to be true.
	 */
	async openDataConnectionsView(): Promise<void> {
		await this.quickaccess.runCommand(DATA_CONNECTIONS_VIEW_FOCUS_COMMAND);
		await expect(this.addConnectionButton).toBeVisible();
	}

	/**
	 * Opens the new-connection flow by clicking the Add Connection action.
	 */
	async clickAddConnection(): Promise<void> {
		await this.addConnectionButton.click();
		await expect(this.dialog).toBeVisible();
	}

	/**
	 * Selects a provider in the "Add Data Connection" dialog and advances to the configure step.
	 * @param providerName The driver name shown on the provider card, e.g. 'PostgreSQL'.
	 */
	async selectProvider(providerName: string): Promise<void> {
		await test.step(`Select provider: ${providerName}`, async () => {
			await this.dialog.locator('.driver-card').filter({ hasText: providerName }).click();
			await this.nextButton.click();
		});
	}

	/**
	 * Selects a connection mechanism in the "Select how to connect" dialog and advances to the
	 * configure step. This dialog only appears for providers that expose more than one mechanism.
	 * @param mechanismLabel The label shown on the mechanism card, e.g. 'User & Password'.
	 */
	async selectConnectionMechanism(mechanismLabel: string): Promise<void> {
		await test.step(`Select connection mechanism: ${mechanismLabel}`, async () => {
			await this.dialog.locator('.mechanism-card').filter({ hasText: mechanismLabel }).click();
			await this.nextButton.click();
		});
	}

	/**
	 * Fills the connection form fields in the "Configure Database" dialog. Labels (e.g. 'Connection
	 * Name', 'Host', 'Port', 'Database', 'User', 'Password') map to the text to enter. Pass an object
	 * for plain string labels, or an array of `[label, value]` entries when a label needs a RegExp
	 * (e.g. `/^User/` to match a field rendered with an "(optional)" suffix). Note that `exact` is
	 * ignored for RegExp matchers, so anchor the pattern yourself.
	 * @param fields A map of field label to value, as an object or an array of entries.
	 */
	async fillConnectionInputs(fields: Record<string, string> | [string | RegExp, string][]): Promise<void> {
		const entries = Array.isArray(fields) ? fields : Object.entries(fields);
		await test.step('Fill connection inputs', async () => {
			for (const [label, value] of entries) {
				const field = this.dialog.locator(PARAMETER_FIELD).filter({
					has: this.code.driver.currentPage.getByText(label, { exact: true })
				});
				await field.locator('.parameter-input').fill(value);
			}
		});
	}

	/**
	 * Saves the connection in the "Configure Database" dialog and waits for it to close.
	 */
	async save(): Promise<void> {
		await this.saveButton.click();
		await expect(this.dialog).toBeHidden();
	}

	/**
	 * Asserts that a connection profile is present in the tree.
	 * @param connectionName The connection name shown in the tree.
	 */
	async expectConnectionInTree(connectionName: string): Promise<void> {
		await expect(
			this.connectionEntries.filter({ hasText: connectionName })
		).toBeVisible();
	}

	/**
	 * Returns the tree row whose node label exactly matches the given text. Exact matching avoids
	 * false matches between names that share a substring (e.g. 'actor' vs 'actor_info').
	 * @param label The node label, e.g. 'Schemas', 'public', 'Tables', 'actor'.
	 */
	private treeRow(label: string): Locator {
		return this.code.driver.currentPage.locator(TREE_ROW).filter({
			has: this.code.driver.currentPage.getByText(label, { exact: true })
		});
	}

	/**
	 * Expands a row's twisty, if it is currently collapsed. No-op if already expanded (toggling an
	 * expanded twisty would collapse it). Waits for the twisty to leave the collapsed state so child
	 * rows have begun loading before returning.
	 *
	 * Uses `dispatchEvent('click')` rather than `click()`: the tree renders inside a virtualized
	 * data grid that uses `clip-path` (not native scrolling) and absolutely-positioned rows. A
	 * coordinate-based `click()` on a row pushed below the clip edge lands on whichever row is
	 * visually there, toggling the wrong node. Dispatching the event directly fires the twisty's
	 * onClick handler on the correct element regardless of its scroll position.
	 */
	private async expandRow(row: Locator, label: string): Promise<void> {
		await test.step(`Expand node: ${label}`, async () => {
			// Reveal the row so it is rendered before interacting with it: the grid renders no
			// overscan, so a row below the fold is absent from the DOM (and a prior step may have
			// scrolled the grid). revealNode scrolls it into the rendered range; toBeVisible then
			// waits for the row to finish loading after its parent expanded.
			await this.revealNode(row);
			await expect(row).toBeVisible();

			const collapsedTwisty = row.locator(TREE_TWISTY_COLLAPSED);
			if (await collapsedTwisty.count() > 0) {
				await collapsedTwisty.first().dispatchEvent('click');
				await expect(row.locator(TREE_TWISTY_COLLAPSED)).toHaveCount(0);
			}
		});
	}

	/**
	 * Expands the root connection entry, opening the live connection.
	 * @param connectionName The connection name shown in the tree.
	 */
	async expandConnection(connectionName: string): Promise<void> {
		const row = this.code.driver.currentPage.locator(TREE_ROW)
			.filter({ has: this.connectionEntries.filter({ hasText: connectionName }) });
		await this.expandRow(row, connectionName);
	}

	/**
	 * Expands a tree node by its label.
	 * @param label The node label to expand, e.g. 'Schemas', 'public', 'Tables', 'Views'.
	 */
	async expandNode(label: string): Promise<void> {
		await this.expandRow(this.treeRow(label), label);
	}

	/**
	 * Double-clicks a previewable node (table, view, or column) to open it in the Data Explorer.
	 * Reveals the row first so it is rendered, then dispatches the dblclick event directly on the
	 * node row. Like {@link expandRow}, this uses `dispatchEvent` rather than a coordinate-based
	 * click because the tree is a virtualized grid with absolutely-positioned rows.
	 * @param label The node label, e.g. 'actor' or 'first_name'.
	 */
	async doubleClickNode(label: string): Promise<void> {
		await test.step(`Double-click node: ${label}`, async () => {
			const row = this.treeRow(label);
			await this.revealNode(row);
			await expect(row).toBeVisible();
			await row.locator('.data-connection-node-row').dispatchEvent('dblclick');
		});
	}

	/**
	 * Scrolls the virtualized tree to the top by hovering the grid and wheeling up past the start
	 * (the offset is clamped to zero).
	 */
	private async scrollToTop(): Promise<void> {
		const page = this.code.driver.currentPage;
		await page.locator(TREE_WAFFLE).hover();
		await page.mouse.wheel(0, -100000);
	}

	/**
	 * Scrolls the virtualized tree until the given row is rendered. The grid renders no overscan, so
	 * a row below the fold is absent from the DOM; without this it would never become visible. Resets
	 * to the top first, then wheels down so the search is deterministic regardless of current scroll.
	 * Returns immediately if the row is already rendered.
	 */
	private async revealNode(row: Locator): Promise<void> {
		if (await row.count() > 0) {
			return;
		}

		const page = this.code.driver.currentPage;
		await this.scrollToTop();
		for (let i = 0; i < 60 && await row.count() === 0; i++) {
			await page.mouse.wheel(0, 200);
		}
	}

	/**
	 * Asserts that a tree node with the given label is visible, scrolling it into view if needed.
	 * @param label The node label.
	 */
	async expectNodeVisible(label: string): Promise<void> {
		const row = this.treeRow(label);
		await this.revealNode(row);
		await expect(row).toBeVisible();
	}

	/**
	 * Asserts that a column node is visible with the expected name and data type.
	 * @param name The column name, e.g. 'actor_id'.
	 * @param dataType The column data type as shown in the tree, e.g. 'integer'.
	 */
	async expectColumn(name: string, dataType: string): Promise<void> {
		const row = this.treeRow(name);
		await this.revealNode(row);
		await expect(row).toBeVisible();
		await expect(row.locator(NODE_TYPE_BADGE)).toHaveText(dataType);
	}

	/**
	 * Asserts the number of version (pin bundle) nodes currently shown in the tree. Use after
	 * expanding a single pin so the count reflects that pin's versions. Version node labels are
	 * dynamic (creation time + bundle id), so tests key off the count and the active badge rather
	 * than exact names.
	 * @param count The expected number of version nodes.
	 */
	async expectVersionCount(count: number): Promise<void> {
		await expect(this.code.driver.currentPage.locator(VERSION_ROW)).toHaveCount(count);
	}

	/**
	 * Asserts that a version node badged "active" is visible: the pin's currently served bundle. This
	 * is the deterministic anchor on version nodes (their names carry a dynamic timestamp/bundle id),
	 * so it works against a real server where the version count is unknown. Reveals the row first, as
	 * an expanded pin's versions can sit below the fold.
	 */
	async expectActiveVersionVisible(): Promise<void> {
		const activeVersion = this.code.driver.currentPage.locator(VERSION_ROW)
			.filter({ has: this.code.driver.currentPage.locator(NODE_TYPE_BADGE, { hasText: 'active' }) });
		await this.revealNode(activeVersion);
		await expect(activeVersion).toBeVisible();
	}
}
