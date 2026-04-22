/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, FrameLocator } from '@playwright/test';
import { Code } from '../infra/code';
import { Toasts } from './dialog-toasts';

// Webview frame selectors (Posit Assistant renders inside a VS Code webview)
const OUTER_FRAME = '.webview';
const INNER_FRAME = '#active-frame';

// Activity bar button and sidebar view
const ACTIVITY_BAR_BUTTON = 'a.action-label[aria-label="Posit Assistant"]';

// Header buttons
const NEW_CHAT_BUTTON = 'button:has(svg.lucide-plus)';
const HISTORY_BUTTON = 'button:has(svg.lucide-history)';
const MORE_BUTTON = 'button:has(svg.lucide-ellipsis):has(.sr-only:text("More"))';
const SETTINGS_BUTTON = 'button:has(svg.lucide-settings):has(.sr-only:text("Settings"))';

// Workspace trust dialog
const TRUST_DIALOG = '[role="dialog"]:has(h2:has-text("Do you trust this workspace?"))';
const TRUST_BUTTON = 'button.bg-primary:has-text("Trust this workspace")';

// Welcome/landing page elements
const WELCOME_TITLE = '.text-4xl:has-text("Posit Assistant")';

// Chat input area
const CHAT_INPUT = 'textarea[placeholder="Ask Posit Assistant... Type / to see commands"]';
const SEND_BUTTON = 'button:has(svg.lucide-arrow-up)';
const STOP_BUTTON = 'button:has(svg.lucide-square)';

// Chat message elements
const CHAT_MESSAGE_USER = '.chat-message-user';
const CHAT_MESSAGE_ASSISTANT = '.chat-message-assistant';
const CHAT_MESSAGE_CONTENT = '.message-content';

// Inline plot image
const INLINE_PLOT = '.chat-messages img[alt^="Plot"]';

// Code block elements
const CODE_BLOCK = '.monaco-editor[role="code"]';
const CODE_BLOCK_COPY_BUTTON = 'button[aria-label="Copy"]';
const CODE_BLOCK_INSERT_CURSOR_BUTTON = 'button[aria-label="Insert At Cursor"]';
const CODE_BLOCK_INSERT_FILE_BUTTON = 'button[aria-label="Insert into New File"]';

// Tool confirmation UI
const TOOL_CONFIRM_TITLE = 'h4.font-semibold';
const TOOL_ALLOW_BUTTON = 'button.rounded-r-none:has-text("Allow")';
const TOOL_ALLOW_DROPDOWN_TRIGGER = 'button[aria-label="More allow options"]';
const TOOL_ALLOW_SESSION_MENU_ITEM = '[role="menuitem"]:has-text("for this session")';
const TOOL_DECLINE_BUTTON = 'button.rounded-r-none:has-text("Decline")';

/**
 * Page object for the Posit Assistant extension.
 * Posit Assistant is an AI chat assistant that renders inside a VS Code webview,
 * so most element access requires navigating through nested iframes.
 */
export class PositAssistant {

	constructor(private code: Code) { }

	/**
	 * Gets the frame locator for the Posit Assistant webview content.
	 * All UI elements live inside this nested iframe.
	 */
	get frame(): FrameLocator {
		return this.code.driver.page.frameLocator(OUTER_FRAME).frameLocator(INNER_FRAME);
	}

	/**
	 * Ensures the Posit Assistant sidebar view is open.
	 * Clicks the activity bar icon if it is not already selected.
	 */
	async open(): Promise<void> {
		const button = this.code.driver.page.locator(ACTIVITY_BAR_BUTTON);
		const isSelected = await button.locator('..').getAttribute('aria-selected');
		if (isSelected !== 'true') {
			await button.click();
		}
		await expect(button.locator('..')).toHaveAttribute('aria-selected', 'true');
	}

	/**
	 * Accepts the workspace trust dialog if it appears.
	 * This dialog may or may not appear depending on workspace state.
	 */
	async acceptTrustDialogIfPresent(): Promise<void> {
		const trustDialog = this.frame.locator(TRUST_DIALOG);
		const isVisible = await trustDialog.isVisible().catch(() => false);
		if (isVisible) {
			await trustDialog.locator(TRUST_BUTTON).click();
		}
	}

	/**
	 * Waits for Posit Assistant to be ready by verifying the chat input is visible.
	 * Handles the workspace trust dialog if it appears.
	 * Works on both the landing page and a resumed chat session.
	 * @param timeout Maximum time to wait in milliseconds (default: 30000)
	 */
	async waitForReady(timeout: number = 30000): Promise<void> {
		await this.acceptTrustDialogIfPresent();
		await expect(this.frame.locator(CHAT_INPUT)).toBeVisible({ timeout });
		await expect(this.frame.locator(SEND_BUTTON)).toBeVisible({ timeout });
		await expect(this.frame.locator(STOP_BUTTON)).not.toBeVisible({ timeout });
	}

	/**
	 * Verifies that the welcome title "Posit Assistant" is displayed on the landing page.
	 */
	async expectWelcomeVisible(): Promise<void> {
		await expect(this.frame.locator(WELCOME_TITLE)).toBeVisible();
	}

	// --- Header actions ---

	/**
	 * Starts a new conversation by clicking the new chat button.
	 * If the button is disabled (already on landing page), this is a no-op.
	 */
	async startNewConversation(): Promise<void> {
		const button = this.frame.locator(NEW_CHAT_BUTTON);
		if (await button.isDisabled()) {
			return;
		}
		await button.click();
		await this.waitForReady();
	}

	/**
	 * Clicks the history button in the header.
	 */
	async clickHistory(): Promise<void> {
		await this.frame.locator(HISTORY_BUTTON).click();
	}

	/**
	 * Clicks the more/ellipsis button in the header.
	 */
	async clickMore(): Promise<void> {
		await this.frame.locator(MORE_BUTTON).click();
	}

	/**
	 * Clicks the settings button in the header.
	 */
	async clickSettings(): Promise<void> {
		await this.frame.locator(SETTINGS_BUTTON).click();
	}

	// --- Chat input ---

	/**
	 * Enters a message in the chat input.
	 * @param message The message to enter
	 */
	async enterMessage(message: string): Promise<void> {
		const chatInput = this.frame.locator(CHAT_INPUT);
		await chatInput.waitFor({ state: 'visible' });
		await chatInput.fill(message);
	}

	/**
	 * Clicks the send button to submit the current message.
	 */
	async clickSend(): Promise<void> {
		await this.frame.locator(SEND_BUTTON).click();
	}

	/**
	 * Clicks the stop button to cancel a running response.
	 */
	async clickStop(): Promise<void> {
		await this.frame.locator(STOP_BUTTON).click();
	}

	/**
	 * Sends a chat message with options.
	 * @param message The message to send
	 * @param waitForResponse Whether to wait for the response to complete (default: true)
	 * @param options.newConversation Whether to start a new conversation first (default: true).
	 *   If the button is disabled (already on landing page), this is a no-op.
	 */
	async sendMessage(message: string, waitForResponse: boolean = true, options: { newConversation?: boolean } = {}): Promise<void> {
		const { newConversation = true } = options;
		if (newConversation) {
			await this.startNewConversation();
		}
		await this.enterMessage(message);
		await this.clickSend();
		if (waitForResponse) {
			await this.waitForResponseComplete();
		}
	}

	/**
	 * Waits for the chat response to complete by waiting for the stop button
	 * to appear (busy) and then disappear (done).
	 * @param timeout Maximum time to wait in milliseconds (default: 60000)
	 */
	async waitForResponseComplete(timeout: number = 60000): Promise<void> {
		await this.frame.locator(STOP_BUTTON).waitFor({ state: 'visible' });
		await this.frame.locator(STOP_BUTTON).waitFor({ state: 'hidden', timeout });
	}

	// --- Chat messages ---

	/**
	 * Verifies that an assistant response is visible.
	 */
	async expectResponseVisible(): Promise<void> {
		await expect(this.frame.locator(CHAT_MESSAGE_ASSISTANT)).toBeVisible();
	}

	/**
	 * Gets the text content of the most recent assistant response.
	 */
	async getLastResponseText(): Promise<string> {
		const response = this.frame.locator(`${CHAT_MESSAGE_ASSISTANT} ${CHAT_MESSAGE_CONTENT}`).last();
		return await response.textContent() ?? '';
	}

	/**
	 * Verifies a user message is visible.
	 */
	async expectUserMessageVisible(): Promise<void> {
		await expect(this.frame.locator(CHAT_MESSAGE_USER)).toBeVisible();
	}

	// --- Inline plots ---

	/**
	 * Verifies that an inline plot image is visible in the chat.
	 * @param timeout Maximum time to wait in milliseconds (default: 30000)
	 */
	async expectInlinePlotVisible(timeout: number = 30000): Promise<void> {
		await expect(this.frame.locator(INLINE_PLOT).first()).toBeVisible({ timeout });
	}

	/**
	 * Verifies the first inline plot image is not blank.
	 *
	 * Inline plots are served as vscode-resource PNGs (e.g.
	 * https://file+.vscode-resource.vscode-cdn.net/.../<hash>.png). Drawing
	 * them to a canvas taints it cross-origin, so pixel sampling is
	 * unreliable. Instead, we fetch the PNG bytes directly and check:
	 *   1. The <img> loaded with non-zero natural dimensions.
	 *   2. The response is a PNG (full 8-byte signature: 89 50 4E 47 0D 0A 1A 0A).
	 *   3. The PNG payload is larger than a blank/empty figure would be.
	 *
	 * A real matplotlib/plotnine PNG is typically tens of KB; the "blank
	 * Python chat plot" bug produces a very small PNG (empty figure or a
	 * placeholder). The minBytes threshold targets that.
	 *
	 * @param options.timeout Max time to wait for the plot image (default: 30000)
	 * @param options.minBytes Minimum PNG byte size to consider non-blank (default: 3000)
	 */
	async expectInlinePlotNotBlank(options: { timeout?: number; minBytes?: number } = {}): Promise<void> {
		const { timeout = 30000, minBytes = 3000 } = options;
		const plot = this.frame.locator(INLINE_PLOT).first();
		await expect(plot).toBeVisible({ timeout });

		// Wait for the image to finish loading.
		await plot.evaluate(async (img: HTMLImageElement) => {
			if (!img.complete) {
				await new Promise<void>((resolve, reject) => {
					img.addEventListener('load', () => resolve(), { once: true });
					img.addEventListener('error', () => reject(new Error('image failed to load')), { once: true });
				});
			}
		});

		const result = await plot.evaluate(async (img: HTMLImageElement) => {
			const width = img.naturalWidth;
			const height = img.naturalHeight;
			const src = img.src;

			if (!width || !height) {
				return { ok: false, reason: `image has no natural dimensions (${width}x${height})`, byteLength: 0 };
			}
			if (!src) {
				return { ok: false, reason: 'image src is empty', byteLength: 0 };
			}

			try {
				const response = await fetch(src);
				if (!response.ok) {
					return { ok: false, reason: `fetch failed: HTTP ${response.status}`, byteLength: 0 };
				}
				const bytes = new Uint8Array(await response.arrayBuffer());
				// Full 8-byte PNG signature: 89 50 4E 47 0D 0A 1A 0A
				const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
				const isPng =
					bytes.length >= pngSignature.length &&
					pngSignature.every((b, i) => bytes[i] === b);
				if (!isPng) {
					return {
						ok: false,
						reason: `response is not a PNG (length=${bytes.length}, first bytes=${Array.from(bytes.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join(' ')})`,
						byteLength: bytes.length,
						isPng,
					};
				}
				return {
					ok: true,
					reason: `fetched ${bytes.length} bytes (png=true)`,
					byteLength: bytes.length,
					isPng,
				};
			} catch (e) {
				return { ok: false, reason: `failed to fetch image src: ${String(e)}`, byteLength: 0 };
			}
		});

		expect(result.ok, `Inline plot fetch failed: ${result.reason}`).toBe(true);
		expect(
			result.byteLength,
			`Inline plot appears blank - PNG is only ${result.byteLength} bytes (threshold ${minBytes}). ${result.reason}`,
		).toBeGreaterThanOrEqual(minBytes);
	}

	// --- Code block actions ---

	/**
	 * Clicks the copy button on a code block.
	 * @param index The index of the code block (0-based)
	 */
	async copyCodeBlock(index: number = 0): Promise<void> {
		await this.frame.locator(CODE_BLOCK).nth(index).hover();
		await this.frame.locator(CODE_BLOCK_COPY_BUTTON).nth(index).click();
	}

	/**
	 * Clicks the "Insert At Cursor" button on a code block.
	 * @param index The index of the code block (0-based)
	 */
	async insertCodeBlockAtCursor(index: number = 0): Promise<void> {
		await this.frame.locator(CODE_BLOCK).nth(index).hover();
		await this.frame.locator(CODE_BLOCK_INSERT_CURSOR_BUTTON).nth(index).click();
	}

	/**
	 * Clicks the "Insert into New File" button on a code block.
	 * @param index The index of the code block (0-based)
	 */
	async insertCodeBlockIntoNewFile(index: number = 0): Promise<void> {
		await this.frame.locator(CODE_BLOCK).nth(index).hover();
		await this.frame.locator(CODE_BLOCK_INSERT_FILE_BUTTON).nth(index).click();
	}

	// --- Tool confirmation ---

	/**
	 * Verifies the tool confirmation dialog is visible.
	 */
	async expectToolConfirmVisible(): Promise<void> {
		await expect(this.frame.locator(TOOL_CONFIRM_TITLE)).toBeVisible();
	}

	/**
	 * Selects "Allow for this session" from the tool confirmation dropdown.
	 */
	async allowToolForSession(): Promise<void> {
		await this.frame.locator(TOOL_ALLOW_DROPDOWN_TRIGGER).click();
		await this.frame.locator(TOOL_ALLOW_SESSION_MENU_ITEM).click();
	}

	/**
	 * Clicks the main "Allow" button on the tool confirmation dialog (allow once).
	 */
	async allowToolOnce(): Promise<void> {
		await this.frame.locator(TOOL_ALLOW_BUTTON).click();
	}

	/**
	 * Clicks "Decline" on the tool confirmation dialog.
	 */
	async declineTool(): Promise<void> {
		await this.frame.locator(TOOL_DECLINE_BUTTON).click();
	}

	// --- Dev build update check ---

	/**
	 * Enables the Posit Assistant auto dev-build update check, triggers the
	 * `posit-assistant.checkForDevBuildUpdate` command, and drives the resulting
	 * toast flow: clicks "Update Now" on the first toast, then clicks "Reload"
	 * on the follow-up toast to reload Positron.
	 *
	 * Note: this is for Posit Assistant (not Positron Assistant).
	 *
	 * @param settings The settings fixture used to write the user setting.
	 * @param quickaccess The quickaccess page object used to run the command.
	 * @param options.toastTimeout Maximum time to wait for each toast (default: 30000).
	 */
	async checkForDevBuildUpdate(
		settings: {
			set: (
				settings: Record<string, unknown>,
				options?: { reload?: boolean | 'web'; waitMs?: number; waitForReady?: boolean; keepOpen?: boolean }
			) => Promise<void>;
		},
		quickaccess: {
			runCommand: (command: string, options?: { exactLabelMatch?: boolean }) => Promise<any>;
		},
		options: { toastTimeout?: number } = {},
	): Promise<void> {
		const { toastTimeout = 30000 } = options;

		// 1. Enable the auto dev-build update check setting.
		await settings.set({ 'assistant.autoDevBuildUpdateCheck': true });

		// 2. Trigger the dev-build update check command.
		await quickaccess.runCommand('posit-assistant.checkForDevBuildUpdate');

		const toasts = new Toasts(this.code);

		// 3. Wait for the "newer dev build available" toast. If it doesn't appear
		//    (already up to date or update server unreachable), treat as a no-op.
		let updateAvailable = true;
		try {
			await toasts.waitForAppear(/newer Posit Assistant dev build is available/i, { timeout: toastTimeout });
		} catch {
			updateAvailable = false;
		}

		if (!updateAvailable) {
			return;
		}

		await toasts.clickButton('Update Now');

		// 4. Wait for the follow-up "reload to apply changes" toast and click "Reload".
		await toasts.waitForAppear(/Posit Assistant has been updated\. You must reload Positron/i, { timeout: toastTimeout });
		await toasts.clickButton('Reload');

		// 5. Clicking Reload reloads the window natively. Wait for the
		//    workbench to come back up.
		await this.code.driver.page.waitForTimeout(3000);
		await this.code.driver.page.locator('.monaco-workbench').waitFor({ state: 'visible' });
	}

}
