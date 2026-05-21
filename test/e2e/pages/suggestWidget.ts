/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, Locator } from '@playwright/test';
import { Code } from '../infra/code';

const WIDGET = '.suggest-widget.visible';
const FOCUSED_ROW = `${WIDGET} .monaco-list-row.focused`;
const SNIPPET_ICON = '.codicon-symbol-snippet';
// The details panel is overlay-positioned on document.body, not nested in
// the widget, so it has its own top-level selector.
const DETAILS_CONTAINER = '.suggest-details-container';

/**
 * Monaco's editor suggest widget. Encapsulates trigger / toggle-details /
 * focused-row navigation. Used by tests that need to drive completions
 * deterministically (typing alone is racy across language extensions, and
 * the details panel ships hidden by default in some configurations).
 */
export class SuggestWidget {
	readonly widget: Locator;
	readonly detailsContainer: Locator;
	readonly focusedRow: Locator;

	constructor(private code: Code) {
		this.widget = this.code.driver.currentPage.locator(WIDGET);
		this.detailsContainer = this.code.driver.currentPage.locator(DETAILS_CONTAINER);
		this.focusedRow = this.code.driver.currentPage.locator(FOCUSED_ROW);
	}

	/**
	 * Locator for a row inside the visible widget whose textContent contains
	 * the given substring. Use as a Playwright locator (good for visibility
	 * waits); pair with {@link tagRow} when you need a stable CSS selector
	 * for `annotate()` (which uses plain querySelector).
	 */
	rowByText(text: string): Locator {
		return this.widget.locator('.monaco-list-row', { hasText: text });
	}

	/**
	 * Trigger the suggest widget via `editor.action.triggerSuggest` (Ctrl+Space).
	 * Wrapped in toPass so a missed first press (focus not yet in editor) is
	 * retried. No-op once the widget is already visible.
	 */
	async trigger({ timeout = 15_000 }: { timeout?: number } = {}): Promise<void> {
		await expect(async () => {
			await this.code.driver.currentPage.keyboard.press('Control+Space');
			await expect(this.widget).toBeVisible({ timeout: 3_000 });
		}).toPass({ timeout });
	}

	/**
	 * Toggle the side details panel. `editor.action.toggleSuggestionDetails`
	 * shares the Ctrl+Space binding with triggerSuggest, disambiguated by
	 * widget visibility — so we only press it after `trigger()` has resolved.
	 */
	async toggleDetails({ timeout = 10_000 }: { timeout?: number } = {}): Promise<void> {
		await expect(async () => {
			await this.code.driver.currentPage.keyboard.press('Control+Space');
			await expect(this.detailsContainer).toBeVisible({ timeout: 2_000 });
		}).toPass({ timeout });
	}

	/**
	 * Walk focus with ArrowDown until the focused row has a snippet icon.
	 * Keyword/identifier completions for the same prefix typically appear
	 * before the snippet entry, so a few presses land us on the snippet.
	 */
	async focusSnippetRow(maxSteps = 8): Promise<void> {
		for (let i = 0; i < maxSteps; i++) {
			const isSnippet = await this.focusedRow
				.locator(SNIPPET_ICON)
				.first()
				.isVisible()
				.catch(() => false);
			if (isSnippet) {
				return;
			}
			await this.code.driver.currentPage.keyboard.press('ArrowDown');
		}
	}

	/**
	 * Add `data-screenshot-target="<id>"` to the first row whose textContent
	 * contains `match`. Lets {@link annotate} (which uses querySelector and
	 * doesn't understand Playwright's :has-text) find the row by a stable
	 * CSS attribute selector.
	 */
	async tagRow(match: string, id: string): Promise<void> {
		await this.code.driver.currentPage.evaluate(
			({ widget, match, id }) => {
				const rows = document.querySelectorAll(`${widget} .monaco-list-row`);
				for (const row of rows) {
					if ((row.textContent ?? '').includes(match)) {
						row.setAttribute('data-screenshot-target', id);
						return;
					}
				}
			},
			{ widget: WIDGET, match, id },
		);
	}

	/**
	 * Same as {@link tagRow} but matches against a regex applied to the row's
	 * textContent. Useful when the row identity needs whole-word matching
	 * (e.g. distinguishing `function` from `functionBody`).
	 */
	async tagRowByRegex(pattern: RegExp, id: string): Promise<void> {
		await this.code.driver.currentPage.evaluate(
			({ widget, source, flags, id }) => {
				const re = new RegExp(source, flags);
				const rows = document.querySelectorAll(`${widget} .monaco-list-row`);
				for (const row of rows) {
					if (re.test(row.textContent ?? '')) {
						row.setAttribute('data-screenshot-target', id);
						return;
					}
				}
			},
			{ widget: WIDGET, source: pattern.source, flags: pattern.flags, id },
		);
	}
}
