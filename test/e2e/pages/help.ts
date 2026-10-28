/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/


import { FrameLocator, Locator } from '@playwright/test';
import { Code } from '../infra/code';
import { QuickAccess } from './quickaccess';

const OUTER_FRAME = '.webview';
const MIDDLE_FRAME = '#active-frame';
const INNER_FRAME = '#help-iframe';
const HELP_CONTAINER = '.positron-help-container';
const RESIZE_SASH = '.monaco-sash.horizontal:not(.disabled)';
const AUX_BAR = '.part.auxiliarybar';
const HELP_VIEW_FOCUS_COMMAND = 'workbench.panel.positronHelp.focus';

/*
 *  Reuseable Positron Help functionality for tests to leverage.
 */
export class Help {

	private get auxilaryBar(): Locator { return this.code.driver.currentPage.locator(AUX_BAR); }

	constructor(private code: Code, private quickaccess: QuickAccess) { }

	async openHelpPanel(): Promise<void> {
		await this.code.driver.currentPage.locator('.action-label[aria-label="Help"]').click();
	}

	async getHelpWelcomePageFrame() {
		const outerFrame = this.code.driver.currentPage.locator(OUTER_FRAME).first().contentFrame();
		const innerInnerFrame = outerFrame.frameLocator(MIDDLE_FRAME);
		return innerInnerFrame;
	}

	/**
	 * FrameLocator for the Help pane's content iframe. Help is always the LAST
	 * `.webview` (opened after editors/notebooks/plots), so `.last()` resolves it
	 * immediately; a fixed `.nth(n)` races a shifting index while a transient
	 * webview exists.
	 */
	async getHelpFrame(): Promise<FrameLocator> {
		const outerFrame = this.code.driver.currentPage.locator(OUTER_FRAME).last().contentFrame();
		const innerFrame = outerFrame.frameLocator(MIDDLE_FRAME);
		const innerInnerFrame = innerFrame.frameLocator(INNER_FRAME);
		return innerInnerFrame;
	}

	/**
	 * The Help search box. Its name includes the foreground session's language,
	 * e.g. "Search R Help".
	 */
	getSearchInput(): Locator {
		return this.code.driver.currentPage.getByRole('combobox', { name: /^Search .+ Help$/ });
	}

	/**
	 * A suggestion in the Help search list, matched by its exact label and,
	 * optionally, its detail (the package name for R topics).
	 */
	getSearchSuggestion(label: string, detail?: string): Locator {
		const page = this.code.driver.currentPage;
		const exactly = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
		let option = page.getByRole('listbox', { name: 'Help topics' }).getByRole('option')
			.filter({ has: page.locator('.label', { hasText: exactly(label) }) });
		if (detail) {
			option = option.filter({ has: page.locator('.detail', { hasText: exactly(detail) }) });
		}
		return option;
	}

	/**
	 * Show the Help view and search for `query` with the Help search box.
	 */
	async search(query: string): Promise<void> {
		await this.quickaccess.runCommand(HELP_VIEW_FOCUS_COMMAND);
		const input = this.getSearchInput();
		await input.fill(query);
		await input.press('Enter');
	}

	/**
	 * Show the Help view, type `query` in the Help search box, and pick the
	 * suggestion with the given label and detail.
	 */
	async selectSearchSuggestion(query: string, label: string, detail?: string): Promise<void> {
		await this.quickaccess.runCommand(HELP_VIEW_FOCUS_COMMAND);
		await this.getSearchInput().fill(query);
		await this.getSearchSuggestion(label, detail).click();
	}

	getHelpContainer(): Locator {
		return this.auxilaryBar.locator(HELP_CONTAINER);
	}

	getHelpHeader(): Locator {
		return this.auxilaryBar.getByRole('button', { name: 'Help Section' });
	}

	async resizeHelpPanel(delta: { x?: number; y?: number }): Promise<void> {
		const sashLocator = this.auxilaryBar.locator(RESIZE_SASH);
		const sashLocation = await sashLocator.boundingBox();
		if (!sashLocation) {
			throw new Error('Could not find sash');
		}

		const middleOfSash = { x: sashLocation.x + sashLocation.width / 2, y: sashLocation.y + sashLocation.height / 2 };

		// Select the sash to resize
		await this.code.driver.clickAndDrag({
			from: middleOfSash,
			delta
		});
	}
}
