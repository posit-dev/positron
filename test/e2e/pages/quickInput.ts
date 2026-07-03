/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import test, { expect, Locator } from '@playwright/test';
import { Code } from '../infra/code';

const QUICK_INPUT_LIST = '.quick-input-widget .quick-input-list';

export class QuickInput {
	private static QUICK_INPUT = '.quick-input-widget';
	private static QUICK_INPUT_INPUT = `${QuickInput.QUICK_INPUT} .quick-input-box input`;
	private static QUICK_INPUT_RESULT = `${QuickInput.QUICK_INPUT} .quick-input-list .monaco-list-row`;
	// Note: this only grabs the label and not the description or detail
	private static QUICK_INPUT_ENTRY_LABEL = `${this.QUICK_INPUT_RESULT} .quick-input-list-row > .monaco-icon-label .label-name`;
	private static QUICKINPUT_OK_BUTTON =
		'.quick-input-widget .quick-input-action a:has-text(\'OK\')';
	quickInputList: Locator;
	quickInput: Locator;
	quickInputTitleBar: Locator;
	quickInputResult: Locator;
	widget: Locator;

	constructor(private code: Code) {
		this.quickInputList = this.code.driver.currentPage.locator(QUICK_INPUT_LIST);
		this.quickInput = this.code.driver.currentPage.locator(
			QuickInput.QUICK_INPUT_INPUT,
		);
		this.quickInputTitleBar =
			this.code.driver.currentPage.locator(`.quick-input-title`);
		this.quickInputResult = this.code.driver.currentPage.locator(
			QuickInput.QUICK_INPUT_RESULT,
		);
		this.widget = this.code.driver.currentPage.locator(QuickInput.QUICK_INPUT);
	}

	/**
	 * Locator for a quick-pick row whose aria-label starts with `prefix`.
	 * Monaco-list rows are virtualized, so aria-label is the most stable
	 * way to address a specific item without relying on DOM index.
	 */
	rowByAriaLabelPrefix(prefix: string): Locator {
		return this.code.driver.currentPage.locator(
			`${QUICK_INPUT_LIST} .monaco-list-row[aria-label^="${prefix}"]`,
		);
	}

	/**
	 * Press ArrowDown until every passed row is rendered in the picker. Use
	 * when a screenshot needs alphabetical neighbors visible together (the
	 * virtualized window only renders ~20 rows, so simply scrolling to one
	 * target may leave neighbors below it un-rendered).
	 *
	 * Wheel-scroll the picker isn't reliable across platforms (no-ops in
	 * Linux CI), so we drive selection through the keyboard.
	 */
	async scrollIntoView(
		rows: Locator[],
		options?: { timeout?: number; intervalMs?: number },
	): Promise<void> {
		const timeout = options?.timeout ?? 60_000;
		const intervalMs = options?.intervalMs ?? 50;
		await expect(async () => {
			await this.code.driver.currentPage.keyboard.press('ArrowDown');
			for (const row of rows) {
				await expect(row).toBeVisible({ timeout: 100 });
			}
		}).toPass({ timeout, intervals: [intervalMs] });
	}

	async expectTitleBarToHaveText(text: string): Promise<void> {
		await expect(this.quickInputTitleBar).toHaveText(text);
	}

	async expectQuickInputResultsToContain(titles: string[]): Promise<void> {
		await test.step('Verify Quick Input results contain expected title', async () => {
			for (let i = 0; i < titles.length; i++) {
				await expect(
					this.quickInputResult.filter({ hasText: titles[i] }),
				).toBeVisible();
			}
		});
	}

	async waitForQuickInputOpened({
		timeout = 3000,
	}: { timeout?: number } = {}): Promise<void> {
		await expect(
			this.code.driver.currentPage.locator(QuickInput.QUICK_INPUT_INPUT),
		).toBeVisible({ timeout });
	}

	/**
	 * Wait for the runtime quick pick to finish interpreter discovery before
	 * interacting with the list. While discovery is in progress the picker sets
	 * its input placeholder to "Discovering interpreters..." (see
	 * languageRuntimeActions.ts) and lists only the interpreters found so far.
	 * Selecting during this window races discovery: a version-string match can
	 * land on a fast-discovered source (e.g. a uv base install) instead of the
	 * intended interpreter. The placeholder is set synchronously before the
	 * picker is shown, so this assertion cannot pass vacuously mid-discovery.
	 */
	async waitForInterpreterDiscoveryToComplete({ timeout = 30000 }: { timeout?: number } = {}): Promise<void> {
		await expect(
			this.code.driver.currentPage.locator(QuickInput.QUICK_INPUT_INPUT),
		).not.toHaveAttribute('placeholder', /Discovering interpreters/i, { timeout });
	}

	async type(value: string): Promise<void> {
		await this.code.driver.currentPage
			.locator(QuickInput.QUICK_INPUT_INPUT)
			.selectText();
		await this.code.driver.currentPage.keyboard.press('Backspace');
		await this.code.driver.currentPage
			.locator(QuickInput.QUICK_INPUT_INPUT)
			.fill(value);
	}

	async waitForQuickInputElementText(): Promise<string> {
		const quickInputResult = this.code.driver.currentPage.locator(
			QuickInput.QUICK_INPUT_RESULT,
		);

		// Wait for at least one matching element with non-empty text
		await expect(async () => {
			const texts = await quickInputResult.allTextContents();
			return texts.some((text) => text.trim() !== '');
		}).toPass();

		// Retrieve the text content of the first matching element
		const text = await quickInputResult.first().textContent();
		return text?.trim() || '';
	}

	async closeQuickInput(): Promise<void> {
		await this.code.driver.currentPage.keyboard.press('Escape');
		await this.waitForQuickInputClosed();
	}

	async waitForQuickInputElements(
		accept: (names: string[]) => boolean,
	): Promise<void> {
		const locator = this.code.driver.currentPage.locator(
			QuickInput.QUICK_INPUT_ENTRY_LABEL,
		);

		await expect(async () => {
			const names = await locator.allTextContents();
			return accept(names);
		}).toPass();
	}

	async waitForQuickInputClosed(): Promise<void> {
		await expect(
			this.code.driver.currentPage.locator(QuickInput.QUICK_INPUT_INPUT),
		).not.toBeVisible({ timeout: 5000 });
	}

	async selectQuickInputElement(
		index: number,
		keepOpen?: boolean,
	): Promise<void> {
		await this.waitForQuickInputOpened();
		await this.code.driver.currentPage
			.locator(QuickInput.QUICK_INPUT_RESULT)
			.nth(index)
			.click();

		if (!keepOpen) {
			await this.waitForQuickInputClosed();
		}
	}

	async selectQuickInputElementContaining(
		text: string,
		{ timeout, force = true, deprioritize }: { timeout?: number; force?: boolean; deprioritize?: string[] } = {},
	): Promise<string> {
		const matches = this.code.driver.currentPage
			.locator(`${QuickInput.QUICK_INPUT_RESULT}[aria-label*="${text}"]`);

		// By default select the first matching row. When `deprioritize` is set and
		// several rows share `text` (e.g. a project venv and a base pyenv both
		// labeled "Python 3.10.12"), prefer the first row whose aria-label contains
		// none of the deprioritized source markers.
		//
		// Interpreter discovery resolves each environment's version asynchronously,
		// so on a cold pass the intended environment (e.g. a venv "(uv: name)") may
		// not yet be labelled with its version -- meanwhile a deprioritized source
		// that shares the version (e.g. a uv-managed standalone "(Unknown)") is
		// already matchable. Selecting it then reads as success, so the caller's
		// retry never re-fires and the wrong interpreter is used.
		//
		// To avoid that: poll briefly for a non-deprioritized match. If none
		// appears but other interpreter rows for this language are still present
		// (more language rows than version matches -- i.e. the intended one is
		// likely still resolving), throw so the caller's retry (which re-runs
		// discovery / refreshInterpreters) can re-fire. Only fall back to a
		// deprioritized match when this is the sole interpreter for the language
		// (e.g. a platform where just the base interpreter is installed), so
		// single-interpreter setups still work without a long wait.
		//
		// Skip all of this when `text` already names a deprioritized source (e.g.
		// "Python 3.12.10 (Pyenv)"): the caller asked for that interpreter
		// explicitly, so there is no ambiguity to resolve -- select the match
		// directly rather than treating it as a row to avoid.
		let target = matches.first();
		const textSpecifiesSource = deprioritize?.some(source => text.includes(source)) ?? false;
		if (deprioritize?.length && !textSpecifiesSource) {
			await expect(target).toBeVisible({ timeout });
			const languagePrefix = text.split(' ')[0];
			const languageRows = this.code.driver.currentPage
				.locator(`${QuickInput.QUICK_INPUT_RESULT}[aria-label*="${languagePrefix} "]`);
			const findPreferred = async (): Promise<Locator | undefined> => {
				const count = await matches.count();
				for (let i = 0; i < count; i++) {
					const row = matches.nth(i);
					const ariaLabel = (await row.getAttribute('aria-label')) ?? '';
					if (!deprioritize.some(source => ariaLabel.includes(source))) {
						return row;
					}
				}
				return undefined;
			};
			const deadline = Date.now() + Math.max(timeout ?? 0, 5_000);
			let preferred = await findPreferred();
			while (!preferred && Date.now() < deadline) {
				await this.code.driver.currentPage.waitForTimeout(250);
				preferred = await findPreferred();
			}
			if (!preferred) {
				const [languageCount, matchCount] = await Promise.all([languageRows.count(), matches.count()]);
				// TEMP DIAG: log all match labels to understand the selection race.
				const labels: string[] = [];
				for (let i = 0; i < matchCount; i++) {
					labels.push((await matches.nth(i).getAttribute('aria-label')) ?? '');
				}
				this.code.logger.log(`[SEL-DIAG] text="${text}" matchCount=${matchCount} languageCount=${languageCount} labels=${JSON.stringify(labels)}`);
				if (languageCount > matchCount) {
					throw new Error(
						`Only deprioritized matches for "${text}" (${matchCount} of ${languageCount} ` +
						`${languagePrefix} interpreters); the intended interpreter is likely still ` +
						`resolving. Retrying to let discovery complete.`);
				}
			} else {
				this.code.logger.log(`[SEL-DIAG] text="${text}" selected non-deprioritized: ${(await preferred.getAttribute('aria-label')) ?? ''}`);
			}
			target = preferred ?? matches.first();
		}

		const targetResult =
			(await target
				.locator('.quick-input-list-row')
				.nth(0)
				.textContent({ timeout })) || '';
		await target.click({ force, timeout });
		await this.code.driver.currentPage.mouse.move(0, 0);

		return targetResult.trim();
	}

	async selectQuickInputElementExact(
		text: string,
		{ timeout, force = true }: { timeout?: number; force?: boolean } = {},
	): Promise<void> {
		await this.waitForQuickInputOpened();
		const exactMatch = this.code.driver.currentPage
			.locator(`${QuickInput.QUICK_INPUT_RESULT}[aria-label="${text}"]`)
			.first();
		await expect(exactMatch).toBeVisible({ timeout });
		await exactMatch.click({ force, timeout });
		await this.code.driver.currentPage.mouse.move(0, 0);
	}

	async clickOkButton(): Promise<void> {
		await this.code.driver.currentPage
			.locator(QuickInput.QUICKINPUT_OK_BUTTON)
			.click();
	}

	async toggleCheckbox(text: string): Promise<void> {
		const row = this.code.driver.currentPage
			.locator(`${QuickInput.QUICK_INPUT_RESULT}[role="checkbox"][aria-label="${text}"]`);
		await row.click();
	}

	async submitInputBox(): Promise<void> {
		await this.code.driver.currentPage.keyboard.press('Enter');
	}
}
