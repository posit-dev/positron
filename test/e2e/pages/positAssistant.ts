/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect, FrameLocator, Locator } from '@playwright/test';
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

// Chat input area.
// Posit Assistant migrated the chat input from a <textarea> to a TipTap/ProseMirror
// rich-text editor: a contenteditable <div class="tiptap-input-editor">. The
// placeholder is no longer a `placeholder` attribute -- it renders as a separate
// aria-hidden overlay -- so target the editor element by its class instead.
const CHAT_INPUT = '.tiptap-input-editor';
const SEND_BUTTON = 'button:has(svg.lucide-arrow-up)';
const STOP_BUTTON = 'button:has(svg.lucide-square)';

// Chat-form overflow (...) menu — hosts the model picker for providers
// (like OpenAI) that do not auto-select a default model.
const CHAT_FORM_OVERFLOW_BUTTON = '.chat-form button[aria-haspopup="menu"]:has(svg.lucide-ellipsis)';

// Model picker containers. The picker renders in two width-dependent modes
// (see selectProviderModel): a flat radio group when inline, and per-provider
// group containers when collapsed into the overflow (...) menu.
const MODEL_RADIO_GROUP = '[data-slot="dropdown-menu-radio-group"]';
const MODEL_MENU_GROUP = '[data-slot="dropdown-menu-group"]';
// The inline model-picker trigger. ModeSelector (left) uses plain buttons and
// the only other status-bar dropdown trigger with a chevron (the persona
// selector) precedes the model selector in the DOM, so the model trigger is the
// last chevron dropdown trigger in the chat form.
const INLINE_MODEL_TRIGGER = '[data-slot="dropdown-menu-trigger"]:has(svg.lucide-chevron-down)';

/**
 * Maps an e2e provider id to the provider's display name as shown in the model
 * picker's group headers. Sourced from the assistant's provider registry
 * (packages/core/src/platform/provider-registry.ts).
 */
const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
	'anthropic-api': 'Anthropic',
	'amazon-bedrock': 'AWS Bedrock',
	'openai-api': 'OpenAI',
	'ms-foundry': 'Microsoft Foundry',
	'posit-ai': 'Posit AI',
};

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
const TOOL_CONFIRM_CARD = '.bg-warning';
const TOOL_ALLOW_BUTTON = 'button.rounded-r-none:has-text("Allow")';
const TOOL_ALLOW_DROPDOWN_TRIGGER = 'button[aria-label="More allow options"]';
const TOOL_ALLOW_SESSION_MENU_ITEM = '[role="menuitem"]:has-text("for this session")';
const TOOL_DECLINE_BUTTON = 'button.rounded-r-none:has-text("Decline")';

// Tool result accordion (rendered in the transcript after a tool runs)
const TOOL_RESULT_ACCORDION_ITEM = '[data-slot="accordion-item"]';

/** Posit Assistant qualifies MCP tool names as `mcp__<server>__<tool>` in the UI. */
function mcpToolId(server: string, tool: string): string {
	return `mcp__${server}__${tool}`;
}

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
		return this.code.driver.currentPage.frameLocator(OUTER_FRAME).frameLocator(INNER_FRAME);
	}

	/**
	 * Ensures the Posit Assistant sidebar view is open.
	 * Clicks the activity bar icon if it is not already selected.
	 */
	async open(): Promise<void> {
		const button = this.code.driver.currentPage.locator(ACTIVITY_BAR_BUTTON);
		const isSelected = await button.locator('..').getAttribute('aria-selected');
		if (isSelected !== 'true') {
			await button.click();
		}
		await this.expectViewOpen();
	}

	/**
	 * Assert the Posit Assistant view is the active view in the sidebar by checking
	 * that its activity bar button is selected. This avoids waiting on the webview
	 * to load, so it is a reliable signal that the view container itself is open.
	 */
	async expectViewOpen(): Promise<void> {
		const button = this.code.driver.currentPage.locator(ACTIVITY_BAR_BUTTON);
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
	 *
	 * The new-conversation button is disabled both while a response is streaming
	 * and when the conversation is already empty (`isNewConversation`). That
	 * disabled state is derived from async-loaded webview state (messages-loaded +
	 * streaming), so immediately after the chat input renders the button can be
	 * transiently enabled while messages are still loading, then flip to disabled
	 * once an empty conversation finishes loading. A bare `isDisabled()` snapshot
	 * followed by `click()` races that flip and fails with a 30s click timeout on
	 * a now-disabled button, so guard the click and treat a disabled flip as the
	 * desired "already on a fresh conversation" end state.
	 */
	async startNewConversation(): Promise<void> {
		const button = this.frame.locator(NEW_CHAT_BUTTON);
		if (await button.isDisabled()) {
			// Already on a fresh conversation (or streaming) -- nothing to start.
			return;
		}
		try {
			await button.click({ timeout: 5000 });
		} catch (e) {
			// If the button flipped to disabled mid-click we're already on a fresh
			// conversation, which is the desired end state; otherwise re-throw.
			if (await button.isDisabled()) {
				return;
			}
			throw e;
		}
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
		// The input is a TipTap/ProseMirror contenteditable, not a plain textarea.
		// Click to focus then type so ProseMirror processes the input through its
		// normal keystroke handling; `fill()` is unreliable on rich-text editors.
		await chatInput.click();
		await chatInput.pressSequentially(message);
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
	 * Sends a message and waits for the response to complete, automatically
	 * clicking "Allow for this session" whenever a tool confirmation dialog
	 * appears. Handles multiple tool calls and dialogs that appear before or
	 * after streaming begins.
	 */
	async sendMessageAndWait(message: string, options: { timeout?: number; newConversation?: boolean } = {}): Promise<void> {
		const { timeout = 90000, newConversation = true } = options;
		if (newConversation) {
			await this.startNewConversation();
		}
		await this.enterMessage(message);
		await this.clickSend();

		const stopButton = this.frame.locator(STOP_BUTTON);
		const trigger = this.frame.locator(TOOL_ALLOW_DROPDOWN_TRIGGER);
		const deadline = Date.now() + timeout;

		// Wait for streaming to start
		await stopButton.waitFor({ state: 'visible', timeout });

		// Loop while streaming: click "Allow for this session" whenever the
		// tool confirmation dropdown appears, then wait for it to clear.
		while (await stopButton.isVisible()) {
			if (Date.now() > deadline) {
				throw new Error(`Response did not complete within ${timeout}ms`);
			}
			if (await trigger.isVisible().catch(() => false)) {
				await trigger.click();
				await this.frame.locator(TOOL_ALLOW_SESSION_MENU_ITEM).click();
			} else {
				await this.code.driver.currentPage.waitForTimeout(200);
			}
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

	// --- Model selection ---

	/**
	 * Selects a model for the current conversation.
	 *
	 * In narrow viewports the Posit Assistant renders the model picker in
	 * "menu mode" (see `ModelSelector.tsx`). The chat-form overflow (`...`)
	 * menu contains a `DropdownMenuSub` whose trigger has two spans:
	 * `"Model"` (label) and either the currently-selected model name or
	 * `"Select"` (value when none is selected). Clicking the trigger opens
	 * a submenu with provider groups and their models.
	 *
	 * Each model is a `role="menuitem"` whose display name lives in a
	 * child `<span class="flex-1">`; the accessible name of the menuitem
	 * includes decorations (check icon column, trailing note/multiplier),
	 * so we match on the span text instead.
	 *
	 * Some providers auto-pick a default and do not need this call. Only
	 * top-tier models appear in the initial slice; the rest are hidden behind a
	 * "More models" disclosure, which this method expands automatically when the
	 * requested model isn't already shown.
	 *
	 * @param modelName Exact model name as displayed in the menu (e.g. "GPT-5.4 Mini").
	 */
	async selectModel(modelName: string): Promise<void> {
		// 1. Open the chat-form overflow menu.
		await this.frame.locator(CHAT_FORM_OVERFLOW_BUTTON).click();

		// 2. Open the "Model" submenu. The SubTrigger is identifiable as a
		//    menuitem with aria-haspopup="menu" that contains the literal
		//    "Model" label span; that label is stable across states.
		await this.frame.locator('[role="menuitem"][aria-haspopup="menu"]:has(span:text-is("Model"))').click();

		// 3. Locate the desired model. `:text-is()` is exact-match so
		//    "GPT-5.4" does not collide with "GPT-5.4 Mini". Within each provider
		//    group, less-preferred models (e.g. those flagged with a warning note,
		//    like Microsoft Foundry's "model-router") are collapsed under a "More
		//    models" inline disclosure -- a plain <button>, not a menuitem. Wait
		//    for the submenu to render (the model itself or the disclosure), then
		//    expand the disclosure if the model isn't already shown.
		const model = this.frame.locator(`[role="menuitem"]:has(span.flex-1:text-is("${modelName}"))`);
		const moreModels = this.frame.locator('button:has-text("More models")');
		await expect(model.or(moreModels).first()).toBeVisible();
		if (!(await model.isVisible())) {
			await moreModels.click();
		}

		// 4. Click the model.
		await model.click();

		// Menu closes on selection; wait for the trigger to collapse so
		// subsequent actions (e.g. Send) don't race an open overlay.
		await expect(this.frame.locator(CHAT_FORM_OVERFLOW_BUTTON)).toHaveAttribute('aria-expanded', 'false');
	}

	/**
	 * Selects the top (first / default) model belonging to a specific provider,
	 * scoping the choice to that provider's group in the model picker.
	 *
	 * WHY: More than one provider can be signed in at once. In particular AWS
	 * Bedrock auto-signs-in whenever AWS credentials are present in the
	 * environment, independent of whatever provider a test logged in with. The
	 * picker then shows multiple provider groups, and model display names repeat
	 * across them ("Claude Sonnet 5" appears under both Anthropic and AWS
	 * Bedrock). Selecting by model name alone is provider-ambiguous and can
	 * silently exercise the wrong provider (e.g. an auto-selected Bedrock
	 * default). Scoping to the provider group guarantees the intended
	 * provider+model combination. Picking the group's top model keeps this robust
	 * to the frequent churn in the model list.
	 *
	 * Must be called on a fresh conversation (after `startNewConversation()`),
	 * and the message that follows should be sent with `newConversation: false`,
	 * because starting a new conversation drops the model selection.
	 *
	 * Handles both picker render modes (width-dependent):
	 *  - menu mode (narrow status bar): the overflow (...) menu hosts a "Model"
	 *    submenu where each provider is a `dropdown-menu-group` container.
	 *  - inline mode (wide status bar, e.g. a maximized sidebar): the model
	 *    trigger opens a flat radio group whose provider headers are sibling divs.
	 *
	 * @param provider e2e provider id (e.g. 'anthropic-api', 'amazon-bedrock').
	 */
	async selectProviderModel(provider: string): Promise<void> {
		const providerName = PROVIDER_DISPLAY_NAMES[provider];
		if (!providerName) {
			throw new Error(`No model-picker display name mapped for provider "${provider}"`);
		}

		const overflow = this.frame.locator(CHAT_FORM_OVERFLOW_BUTTON);
		const menuMode = await overflow.isVisible().catch(() => false);
		if (menuMode) {
			await this.selectProviderModelMenuMode(overflow, providerName);
		} else {
			await this.selectProviderModelInlineMode(providerName);
		}
	}

	/**
	 * Menu-mode path for {@link selectProviderModel}: open the overflow (...)
	 * menu and its "Model" submenu, then click the first model in the provider's
	 * group container.
	 */
	private async selectProviderModelMenuMode(overflow: Locator, providerName: string): Promise<void> {
		await overflow.click();
		// Open the "Model" submenu (SubTrigger carries the stable "Model" label).
		await this.frame.locator('[role="menuitem"][aria-haspopup="menu"]:has(span:text-is("Model"))').click();

		// Scope to the provider's group (label + its model items live in one
		// container), then take its first model item.
		const group = this.frame.locator(
			`${MODEL_MENU_GROUP}:has([data-slot="dropdown-menu-label"] span:text-is("${providerName}"))`,
		);
		await expect(group).toBeVisible();
		await group.locator('[role="menuitem"]').first().click();

		// Menu closes on selection; wait for the trigger to collapse so subsequent
		// actions (e.g. Send) don't race an open overlay.
		await expect(overflow).toHaveAttribute('aria-expanded', 'false');
	}

	/**
	 * Inline-mode path for {@link selectProviderModel}: open the model trigger and
	 * click the provider's top model. The radio group is flat, so the provider's
	 * top model is the header div's immediately-following radio item (adjacent
	 * sibling combinator scopes the choice to that provider).
	 *
	 * The open→select→close cycle is retried because the inline picker is not
	 * stable to drive one-shot:
	 *  - On open it auto-scrolls the selected item into view and runs refocus
	 *    logic, which can transiently close the menu out from under a pending
	 *    click.
	 *  - Base UI radio items do NOT close the menu on selection (unlike the
	 *    regular menu items used in menu mode), so the menu must be dismissed
	 *    explicitly with Escape afterwards, or the overlay blocks the chat input.
	 */
	private async selectProviderModelInlineMode(providerName: string): Promise<void> {
		const trigger = this.frame.locator(INLINE_MODEL_TRIGGER).last();
		const radioGroup = this.frame.locator(MODEL_RADIO_GROUP);
		const topModel = radioGroup.locator(
			`div:has(> span:text-is("${providerName}")) + [role="menuitemradio"]`,
		);
		const page = this.code.driver.currentPage;

		await expect(async () => {
			// Open the picker if it isn't already open (e.g. a prior iteration
			// selected the model but Escape didn't land).
			if (!(await radioGroup.isVisible().catch(() => false))) {
				await trigger.click();
				await expect(radioGroup).toBeVisible({ timeout: 5000 });
			}
			// Short click timeout so a menu that closed mid-open fails fast and we
			// reopen on the next iteration rather than hanging.
			await topModel.click({ timeout: 5000 });
			// Radio selection leaves the menu open; dismiss it so it can't obscure
			// the chat input, and confirm it detached.
			await page.keyboard.press('Escape');
			await expect(radioGroup).toBeHidden({ timeout: 5000 });
		}).toPass({ timeout: 30000 });
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
		await expect(this.frame.locator(TOOL_CONFIRM_CARD).getByRole('heading', { level: 4 })).toBeVisible();
	}

	/** Verifies the tool confirmation dialog identifies a specific MCP server + tool. */
	async expectMcpToolConfirmVisible(server: string, tool: string): Promise<void> {
		await expect(this.frame.locator(TOOL_CONFIRM_CARD)).toContainText(mcpToolId(server, tool));
	}

	/** Locator for the MCP tool-result accordion, rendered after the tool executes. */
	mcpToolResult(server: string, tool: string) {
		return this.frame.locator(
			`${TOOL_RESULT_ACCORDION_ITEM}:has(:scope :text("${mcpToolId(server, tool)}"))`,
		);
	}

	/** Verifies the MCP tool-result accordion is in the transcript. */
	async expectMcpToolResultVisible(server: string, tool: string): Promise<void> {
		await expect(this.mcpToolResult(server, tool)).toBeVisible();
	}

	/**
	 * Asserts a literal text string is anywhere in the chat frame DOM.
	 *
	 * Uses `toBeAttached()` not `toBeVisible()`: tool-result accordion panels
	 * use overflow-hidden + animated height that can read as visually hidden
	 * even when fully expanded.
	 */
	async expectChatContainsText(text: string): Promise<void> {
		await expect(this.frame.getByText(text, { exact: false }).first()).toBeAttached();
	}

	/**
	 * Selects "Allow for this session" from the tool confirmation dropdown.
	 */
	async allowToolForSession(): Promise<void> {
		await this.frame.locator(TOOL_ALLOW_DROPDOWN_TRIGGER).click();
		await this.frame.locator(TOOL_ALLOW_SESSION_MENU_ITEM).click();
	}

	/**
	 * Selects "Allow for this session" if the tool confirmation dropdown appears
	 * within the given timeout. Silently does nothing if it never shows up.
	 *
	 * The tool dialog can appear before OR after streaming begins, so this does
	 * not race against the stop button — it simply waits the full timeout.
	 */
	async allowToolForSessionIfVisible(timeout = 30000): Promise<void> {
		const appeared = await this.frame.locator(TOOL_ALLOW_DROPDOWN_TRIGGER)
			.waitFor({ state: 'visible', timeout })
			.then(() => true)
			.catch(() => false);
		if (appeared) {
			await this.frame.locator(TOOL_ALLOW_DROPDOWN_TRIGGER).click();
			await this.frame.locator(TOOL_ALLOW_SESSION_MENU_ITEM).click();
		}
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
		await this.code.driver.currentPage.waitForTimeout(3000);
		await this.code.driver.currentPage.locator('.monaco-workbench').waitFor({ state: 'visible' });
	}

}
