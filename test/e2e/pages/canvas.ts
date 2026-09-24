/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, FrameLocator, Page } from '@playwright/test';
import { Code } from '../infra/code';

// Canvas renders Posit Assistant's Canvas panel (a webview) in a dedicated
// auxiliary window while the IDE window is hidden. The selectors below are the
// assistant's stable test ids (packages/canvas/src/client/shell/CanvasTopBar.tsx
// and CanvasWorkspaceMenu.tsx in posit-dev/assistant).
const OUTER_FRAME = '.webview';
const INNER_FRAME = '#active-frame';
const TOP_BAR = '[data-testid="canvas-top-bar"]';
const WORKSPACE_TRIGGER = '[data-testid="canvas-workspace-trigger"]';
const WORKSPACE_MENU = '[data-testid="canvas-workspace-menu"]';
const WORKSPACE_ROW = '[data-testid="canvas-workspace-menu-row"]';
const MENU_ITEM = '[role="menuitem"]';
const ALERT = '[role="alert"]';

/** The Canvas notice for a refused or failed folder switch (CanvasApp.tsx). */
const SWITCH_REFUSAL = 'Couldn\'t switch workspaces';

/** Mirrors `CanvasEntryOutcome` in positronCanvas/common/positronCanvasMode.ts. */
export type CanvasEntryOutcome =
	| { readonly entered: true }
	| { readonly entered: false; readonly reason: string; readonly message: string };

/** One row of the Canvas workspace menu. */
export interface CanvasWorkspaceRow {
	/** The row's text, lines joined with ' | ': name, "Current" tag, path. */
	readonly text: string;
	readonly current: boolean;
}

/**
 * Canvas: the Canvas window and the Positron commands behind it.
 *
 * Commands run in the IDE window's renderer (`code.driver.currentPage`), which
 * owns the Canvas service even while it is hidden. Canvas UI lives in the
 * webview of the Canvas window, a separate page found by content.
 */
export class Canvas {

	constructor(private readonly code: Code) { }

	private get ideWindow(): Page {
		return this.code.driver.currentPage;
	}

	// --- Commands ---

	/** `positron.canvas.enter`: presents Canvas; the outcome says why not. */
	async enter(): Promise<CanvasEntryOutcome> {
		return this.code.driver.executeCommand<CanvasEntryOutcome>('positron.canvas.enter');
	}

	/** `positron.canvas.exit` (Open Positron): true when Canvas mode was left. */
	async exit(): Promise<boolean> {
		return this.code.driver.executeCommand<boolean>('positron.canvas.exit');
	}

	/** `positron.canvas.isActive`: whether Canvas is the only visible surface. */
	async isActive(): Promise<boolean> {
		return this.code.driver.executeCommand<boolean>('positron.canvas.isActive');
	}

	/** `positron.experimental.getCanvasFolders`: recent local folders, most recent first. */
	async recentFolders(): Promise<string[]> {
		return this.code.driver.executeCommand<string[]>('positron.experimental.getCanvasFolders');
	}

	/**
	 * Waits until the IDE window's commands answer, i.e. the workbench and the
	 * Canvas contribution are up. `isActive` is registered by Positron, so this
	 * does not wait for the assistant.
	 */
	async waitForCommands(timeout = 60_000): Promise<void> {
		await expect.poll(async () => this.isActive().then(() => true, () => false), {
			timeout,
			message: 'Canvas commands never answered in the IDE window',
		}).toBe(true);
	}

	// --- Canvas window ---

	/**
	 * The page of the window presenting Canvas: the window other than the IDE
	 * window whose webview shows the Canvas top bar.
	 */
	async page(timeout = 60_000): Promise<Page> {
		let found: Page | undefined;
		await expect.poll(async () => {
			found = await this.findPage();
			return found !== undefined;
		}, { timeout, message: 'No window is showing the Canvas top bar' }).toBe(true);
		return found!;
	}

	/** The Canvas page if one is up now, without waiting. */
	async findPage(): Promise<Page | undefined> {
		for (const candidate of this.code.electronApp!.windows()) {
			if (candidate === this.ideWindow || candidate.isClosed()) {
				continue;
			}
			const count = await Canvas.frame(candidate).locator(TOP_BAR).count().catch(() => 0);
			if (count > 0) {
				return candidate;
			}
		}
		return undefined;
	}

	/** The Canvas webview's inner document in `page`. */
	static frame(page: Page): FrameLocator {
		return page.frameLocator(OUTER_FRAME).frameLocator(INNER_FRAME);
	}

	/**
	 * Waits for the Canvas UI to be interactive, and for its workspace picker
	 * to show `workspaceName` when given. A missing picker means an assistant
	 * without the folder-switch integration (for example a released build that
	 * replaced the one under test), so it fails loudly here.
	 */
	async expectReady(options: { workspaceName?: string; timeout?: number } = {}): Promise<Page> {
		const timeout = options.timeout ?? 90_000;
		const page = await this.page(timeout);
		const trigger = Canvas.frame(page).locator(WORKSPACE_TRIGGER);
		await expect(trigger, 'Canvas has no workspace picker: is the assistant under test the one loaded?').toBeVisible({ timeout });
		if (options.workspaceName !== undefined) {
			await expect(trigger).toHaveText(options.workspaceName, { timeout });
		}
		return page;
	}

	/** The workspace name in the Canvas top bar. */
	async workspaceName(): Promise<string> {
		return (await Canvas.frame(await this.page()).locator(WORKSPACE_TRIGGER).innerText()).trim();
	}

	async openWorkspaceMenu(): Promise<void> {
		const frame = Canvas.frame(await this.page());
		const trigger = frame.locator(WORKSPACE_TRIGGER);
		if (await trigger.getAttribute('aria-expanded') !== 'true') {
			await trigger.click();
		}
		await expect(frame.locator(WORKSPACE_MENU)).toBeVisible();
	}

	async closeWorkspaceMenu(): Promise<void> {
		const page = await this.page();
		if (await Canvas.frame(page).locator(WORKSPACE_MENU).isVisible()) {
			await page.keyboard.press('Escape');
			await expect(Canvas.frame(page).locator(WORKSPACE_MENU)).toBeHidden();
		}
	}

	/** The workspace rows of the open menu (opens it). */
	async workspaceRows(): Promise<CanvasWorkspaceRow[]> {
		await this.openWorkspaceMenu();
		const rows = Canvas.frame(await this.page()).locator(WORKSPACE_ROW);
		// The folder list loads after the menu opens.
		await expect(rows.first()).toBeVisible();
		const result: CanvasWorkspaceRow[] = [];
		for (const row of await rows.all()) {
			const text = (await row.innerText()).split('\n').map(line => line.trim()).filter(Boolean).join(' | ');
			result.push({ text, current: (await row.getAttribute('aria-checked')) === 'true' });
		}
		return result;
	}

	/** Clicks the menu row for `folderPath` (matched on the path the row shows). */
	async clickWorkspaceRow(folderPath: string): Promise<void> {
		await this.openWorkspaceMenu();
		const row = Canvas.frame(await this.page()).locator(WORKSPACE_ROW).filter({ hasText: folderPath });
		await expect(row, `no workspace menu row for ${folderPath}`).toHaveCount(1);
		await row.click();
	}

	/** Clicks "Open existing folder..." in the workspace menu. */
	async clickOpenExistingFolder(): Promise<void> {
		await this.openWorkspaceMenu();
		await Canvas.frame(await this.page()).locator(MENU_ITEM).filter({ hasText: 'Open existing folder' }).click();
	}

	/** The folder-switch refusal notice's text, if one is showing. */
	async refusal(): Promise<string | undefined> {
		const page = await this.findPage();
		if (!page) {
			return undefined;
		}
		const alert = Canvas.frame(page).locator(ALERT).filter({ hasText: SWITCH_REFUSAL });
		return await alert.count() > 0 ? (await alert.first().innerText()).trim() : undefined;
	}

	/** Dismisses the refusal notice. */
	async dismissRefusal(): Promise<void> {
		const alert = Canvas.frame(await this.page()).locator(ALERT).filter({ hasText: SWITCH_REFUSAL });
		await alert.getByRole('button', { name: 'Dismiss' }).click();
		await expect(alert).toHaveCount(0);
	}
}
