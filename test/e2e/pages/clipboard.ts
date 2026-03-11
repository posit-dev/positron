/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from '@playwright/test';
import { Code } from '../infra/code';
import { HotKeys } from './hotKeys.js';

export class Clipboard {

	constructor(private code: Code, private hotKeys: HotKeys) { }

	/**
	 * Detects if we need to use synthetic paste events.
	 * - Electron: No (clipboard works fine)
	 * - Chromium (Chrome): No (grantPermissions works)
	 * - Firefox: No (keyboard shortcuts work)
	 * - Edge, WebKit: Yes (clipboard API restrictions)
	 */
	private needsSyntheticPaste(): boolean {
		const browser = this.code.driver.browser;
		const nativeClipboardWorks = this.code.electronApp
			|| browser?.includes('chrome')
			|| browser === 'firefox';
		return !nativeClipboardWorks;
	}

	/**
	 * Safely grants clipboard permissions. Chromium-only - Firefox/WebKit
	 * don't support programmatic clipboard permission grants.
	 */
	private async tryGrantClipboardPermission(permission: 'clipboard-read' | 'clipboard-write'): Promise<void> {
		try {
			await this.code.driver.browserContext.grantPermissions([permission]);
		} catch {
			// Non-Chromium browser - clipboard permissions not supported via API
		}
	}

	async copy(timeoutMs = 5000): Promise<void> {
		const seed = '__SEED__';
		// Seed the clipboard
		await this.setClipboardText(seed);

		// Wait until clipboard value differs from the seed
		await expect
			.poll(async () => {
				await this.hotKeys.copy();
				return (await this.getClipboardText()) ?? '';
			}, {
				message: 'clipboard should change after copy',
				timeout: timeoutMs,
				intervals: [100, 150, 200, 300, 500, 800],
			})
			.not.toBe(seed);
	}

	async cut(timeoutMs = 5000): Promise<void> {
		const seed = '__SEED__';
		// Seed the clipboard
		await this.setClipboardText(seed);

		// Wait until clipboard value differs from the seed
		await this.hotKeys.cut();

		await expect
			.poll(async () => {
				return (await this.getClipboardText()) ?? '';
			}, {
				message: 'clipboard should change after cut',
				timeout: timeoutMs,
				intervals: [100, 150, 200, 300, 500, 800],
			})
			.not.toBe(seed);
	}

	/**
	 * Pastes content using keyboard shortcut, or synthetic paste event for WebKit.
	 *
	 * @param text Optional text to paste. If provided and running on WebKit, uses synthetic
	 *             paste event to bypass clipboard API restrictions. If not provided or on
	 *             other browsers, uses keyboard shortcut (Cmd+V / Ctrl+V).
	 */
	async paste(text?: string): Promise<void> {
		if (this.needsSyntheticPaste() && text !== undefined) {
			await this.pasteText(text);
		} else {
			await this.hotKeys.paste();
		}
	}

	/**
	 * Pastes text by dispatching a synthetic paste event with the text embedded in clipboardData.
	 * This bypasses navigator.clipboard.readText() which is blocked by WebKit without a real user gesture.
	 */
	private async pasteText(text: string): Promise<void> {
		await this.code.driver.page.evaluate((textToPaste) => {
			const clipboardData = new DataTransfer();
			clipboardData.setData('text/plain', textToPaste);
			const pasteEvent = new ClipboardEvent('paste', {
				bubbles: true,
				cancelable: true,
				clipboardData
			});
			document.activeElement?.dispatchEvent(pasteEvent);
		}, text);
	}

	async getClipboardText(): Promise<string | null> {
		// Grant permissions to read from clipboard (Chromium-only)
		await this.tryGrantClipboardPermission('clipboard-read');

		const clipboardText = await this.code.driver.page.evaluate(async () => {
			try {
				return await navigator.clipboard.readText();
			} catch (error) {
				console.error('Failed to read clipboard text:', error);
				return null;
			}
		});

		return clipboardText;
	}

	async expectClipboardTextToBe(expectedText: string, stripTrailingChar?: string, { timeout = 20000 } = {}): Promise<void> {
		await expect(async () => {
			let clipboardText = await this.getClipboardText();

			if (clipboardText) {
				// Normalize line endings (Windows uses \r\n, but expected data uses \n)
				clipboardText = clipboardText.replace(/\r\n/g, '\n');
			}

			if (stripTrailingChar && clipboardText) {
				// Strip all trailing occurrences of the character, not just one
				while (clipboardText.endsWith(stripTrailingChar)) {
					clipboardText = clipboardText.slice(0, -stripTrailingChar.length);
				}
			}

			expect(clipboardText).toBe(expectedText);
		}, { message: 'clipboard text to be...' }).toPass({ timeout });
	}

	async setClipboardText(text: string): Promise<void> {
		// Grant permissions to write to clipboard (Chromium-only)
		await this.tryGrantClipboardPermission('clipboard-write');

		// Use page context to set clipboard text
		await this.code.driver.page.evaluate(async (textToCopy) => {
			try {
				await navigator.clipboard.writeText(textToCopy);
			} catch (error) {
				console.error('Failed to write text to clipboard:', error);
			}
		}, text);
	}

	async getClipboardImage(): Promise<Buffer | null> {
		// Grant permissions to read from clipboard (Chromium-only)
		await this.tryGrantClipboardPermission('clipboard-read');

		const clipboardImageBuffer = await this.code.driver.page.evaluate(async () => {
			const clipboardItems = await navigator.clipboard.read();
			for (const item of clipboardItems) {
				if (item.types.includes('image/png')) {
					const blob = await item.getType('image/png');
					const arrayBuffer = await blob.arrayBuffer();
					return Array.from(new Uint8Array(arrayBuffer));
				}
			}
			return null;
		});

		return clipboardImageBuffer ? Buffer.from(clipboardImageBuffer) : null;
	}

	async clearClipboard(): Promise<void> {
		// Grant permissions to modify the clipboard (Chromium-only)
		await this.tryGrantClipboardPermission('clipboard-write');

		// Use the page context to overwrite the clipboard
		await this.code.driver.page.evaluate(async () => {
			await navigator.clipboard.writeText(''); // Clear clipboard by writing an empty string
		});
	}
}
