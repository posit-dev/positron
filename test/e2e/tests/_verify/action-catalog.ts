/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import { Application } from '../../infra/application';

type ActionFn = (app: Application, params: Record<string, any>) => Promise<string>;

/**
 * Action catalog: Custom actions and Raw Playwright actions only.
 *
 * POM methods are routed automatically via POST /pom -- no wrappers needed.
 * This catalog is for:
 *   1. Custom actions with logic beyond a single POM call (path resolution, multi-step flows)
 *   2. Raw Playwright actions (snapshot, click, fill, press, etc.)
 *   3. Escape hatches (evaluate, takeScreenshot, resizeWindow)
 */
export const actionCatalog: Record<string, ActionFn> = {

	// =========================================================================
	// Custom: File Operations (path resolution + error recovery)
	// =========================================================================

	/**
	 * Open a file via quick access.
	 * Accepts workspace-relative paths (e.g., "README.md") or absolute paths.
	 * params: { path: string }
	 */
	openFile: async (app, params) => {
		const filePath = params.path;
		if (!filePath) {
			throw new Error('openFile requires a "path" param');
		}
		const fullPath = path.isAbsolute(filePath) ? filePath : path.join(app.workspacePathOrFolder, filePath);
		if (!fs.existsSync(fullPath)) {
			throw new Error(`File not found: ${fullPath} (workspace: ${app.workspacePathOrFolder})`);
		}
		// Non-text files (PDF, images, etc.) open in custom viewers that don't
		// satisfy quickaccess.openFile's editor-activation wait. Use the
		// vscode.open command instead and wait for the tab to appear.
		const nonTextExts = ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.svg', '.webp'];
		const ext = path.extname(fullPath).toLowerCase();
		if (nonTextExts.includes(ext)) {
			await app.workbench.quickaccess.runCommand('workbench.action.quickOpen');
			await app.code.driver.page.keyboard.type(fullPath);
			await app.code.driver.page.keyboard.press('Enter');
			const baseName = path.basename(fullPath);
			await app.code.driver.page.locator(`.tab[aria-label="${baseName}"]`).waitFor({ state: 'visible', timeout: 10000 });
			return `Opened file: ${filePath}`;
		}
		try {
			await app.workbench.quickaccess.openFile(fullPath);
		} catch (err) {
			// Dismiss quick input if it got stuck open
			await app.code.driver.page.keyboard.press('Escape');
			throw err;
		}
		return `Opened file: ${filePath}`;
	},

	/**
	 * Open a data file (CSV, parquet, etc.) in the Data Explorer.
	 * Accepts workspace-relative paths (e.g., "data-files/flights.csv") or absolute paths.
	 * params: { path: string }
	 */
	openDataFile: async (app, params) => {
		const filePath = params.path;
		if (!filePath) {
			throw new Error('openDataFile requires a "path" param');
		}
		const fullPath = path.isAbsolute(filePath) ? filePath : path.join(app.workspacePathOrFolder, filePath);
		if (!fs.existsSync(fullPath)) {
			throw new Error(`File not found: ${fullPath} (workspace: ${app.workspacePathOrFolder})`);
		}
		try {
			await app.workbench.quickaccess.openDataFile(fullPath);
		} catch (err) {
			await app.code.driver.page.keyboard.press('Escape');
			throw err;
		}
		return `Opened data file: ${filePath}`;
	},

	// =========================================================================
	// Custom: Notebook (multi-step flows)
	// =========================================================================

	/**
	 * Create a new Positron notebook (enables setting, reloads, creates).
	 * params: { codeCells?: number, markdownCells?: number, language?: 'Python' | 'R' | null, clearCells?: boolean }
	 * Pass language to select a kernel (triggers interpreter startup). Pass null to skip kernel selection.
	 * Use sessions.start() before this action if you need the interpreter fully ready before running cells.
	 */
	newNotebook: async (app, params) => {
		// Enable Positron notebooks; only browser/web mode needs a reload for this setting
		await app.workbench.settings.set({ 'positron.notebook.enabled': true });
		if (app.web) {
			await app.workbench.hotKeys.reloadWindow(false);
			await app.code.driver.page.waitForTimeout(3000);
			await app.code.driver.page.locator('.monaco-workbench').waitFor({ state: 'visible' });
		}

		const codeCells = params.codeCells ?? 1;
		const markdownCells = params.markdownCells ?? 0;
		const language = params.language ?? 'Python'; // default Python; pass null to skip kernel selection
		const clearCells = params.clearCells ?? true;

		await app.workbench.notebooksPositron.newNotebook({
			codeCells,
			markdownCells,
			language,
			clearCells,
		});

		// Hide the bottom panel to maximize notebook space
		await app.workbench.hotKeys.toggleBottomPanel();

		const langNote = language ? ` with ${language} kernel` : '';
		return `Created notebook with ${codeCells} code cell(s) and ${markdownCells} markdown cell(s)${langNote}`;
	},

	// =========================================================================
	// Custom: Editor execution (Cmd+Enter from a file)
	// =========================================================================

	/**
	 * Write code to a temp file and execute it via Cmd+Enter (statement range execution).
	 * This reliably simulates "execute code from editor" -- the code path that triggers
	 * editor_context_changed notifications and statement range requests.
	 * params: { code: string, language?: "r" | "python" (default "r") }
	 */
	runCodeInEditor: async (app, params) => {
		const code = params.code;
		if (!code) {
			throw new Error('runCodeInEditor requires a "code" param');
		}
		const language = params.language ?? 'r';
		const ext = language === 'python' ? '.py' : '.R';
		const tempName = `_explore_exec${ext}`;
		const tempPath = path.join(app.workspacePathOrFolder, tempName);

		// Write code to a temp file
		fs.writeFileSync(tempPath, code + '\n');

		try {
			// Open the file
			await app.workbench.quickaccess.openFile(tempPath);

			// Select all text so Cmd+Enter executes the full content
			const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
			await app.code.driver.page.keyboard.press(`${modifier}+a`);

			// Execute via Cmd+Enter (sends to active console session)
			await app.code.driver.page.keyboard.press(`${modifier}+Enter`);

			const preview = code.length > 60 ? code.substring(0, 57) + '...' : code;
			return `Executed from editor: "${preview}"`;
		} finally {
			// Clean up temp file
			try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
		}
	},

	// =========================================================================
	// Custom: File creation
	// =========================================================================

	/**
	 * Create a file with the given content and open it in the editor.
	 * Use this to create test files on the fly (.qmd, .py, .R, .csv, etc.)
	 * instead of depending on qa-example-content files.
	 * params: { filename: string, content: string }
	 */
	createFile: async (app, params) => {
		const filename = params.filename;
		const content = params.content;
		if (!filename) {
			throw new Error('createFile requires a "filename" param');
		}
		if (content === undefined) {
			throw new Error('createFile requires a "content" param');
		}
		const tempPath = path.join(app.workspacePathOrFolder, filename);

		// Ensure parent directory exists
		const dir = path.dirname(tempPath);
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}

		fs.writeFileSync(tempPath, content);
		await app.workbench.quickaccess.openFile(tempPath);
		return `Created and opened ${tempPath}`;
	},

	// =========================================================================
	// Custom: Assistant (methods with workspace path or non-obvious signatures)
	// =========================================================================

	/**
	 * Get the assistant's response text (requires workspace path).
	 */
	getChatResponseText: async (app, _params) => {
		const text = await app.workbench.assistant.getChatResponseText(app.workspacePathOrFolder);
		return text;
	},

	/**
	 * Get available tools from the assistant (requires workspace path).
	 */
	getAvailableTools: async (app, _params) => {
		const tools = await app.workbench.assistant.getAvailableTools(app.workspacePathOrFolder);
		return `Available tools (${tools.length}): ${tools.join(', ')}`;
	},

	// =========================================================================
	// Custom: Context menu (handles native macOS menus via dialog-contextMenu)
	// =========================================================================

	/**
	 * Right-click an element and select a menu item from the context menu.
	 * Works with both native (macOS/Electron) and web context menus.
	 * params: { selector: string, menuItem: string, button?: 'left' | 'right' }
	 */
	contextMenu: async (app, params) => {
		const selector = params.selector;
		const menuItem = params.menuItem;
		if (!selector) { throw new Error('contextMenu requires a "selector" param'); }
		if (!menuItem) { throw new Error('contextMenu requires a "menuItem" param'); }
		const button = params.button ?? 'right';
		const locator = app.code.driver.page.locator(selector);
		await app.workbench.contextMenu.triggerAndClick({
			menuTrigger: locator,
			menuItemLabel: menuItem,
			menuTriggerButton: button,
		});
		return `Context menu: selected "${menuItem}" on "${selector}"`;
	},

	// =========================================================================
	// Raw Playwright Actions (Tier 2)
	// =========================================================================

	/**
	 * Get the accessibility tree of the page.
	 * params: { maxLength?: number }
	 */
	snapshot: async (app, params) => {
		const maxLength = params.maxLength ?? 8000;
		const snapshot = await app.code.driver.page.locator('body').ariaSnapshot();
		return snapshot.substring(0, maxLength);
	},

	/**
	 * Click an element by its visible text content.
	 * params: { text: string, exact?: boolean, timeout?: number }
	 */
	clickText: async (app, params) => {
		const text = params.text;
		if (!text) {
			throw new Error('clickText requires a "text" param');
		}
		const exact = params.exact ?? false;
		const timeout = params.timeout ?? 5000;
		await app.code.driver.page.getByText(text, { exact }).click({ timeout });
		return `Clicked text: "${text}"`;
	},

	/**
	 * Click an element by its accessible role and name.
	 * params: { role: string, name?: string, timeout?: number }
	 */
	clickRole: async (app, params) => {
		const role = params.role;
		if (!role) {
			throw new Error('clickRole requires a "role" param');
		}
		const name = params.name;
		const timeout = params.timeout ?? 5000;
		const options: Record<string, unknown> = {};
		if (name) {
			options.name = name;
		}
		await app.code.driver.page.getByRole(role as any, options).click({ timeout });
		return `Clicked ${role}${name ? `: "${name}"` : ''}`;
	},

	/**
	 * Click an element by CSS selector.
	 * params: { selector: string, force?: boolean, dblclick?: boolean, timeout?: number }
	 */
	clickSelector: async (app, params) => {
		const selector = params.selector;
		if (!selector) {
			throw new Error('clickSelector requires a "selector" param');
		}
		const force = params.force ?? false;
		const dblclick = params.dblclick ?? false;
		const timeout = params.timeout ?? 5000;
		const locator = app.code.driver.page.locator(selector);
		if (dblclick) {
			await locator.dblclick({ force, timeout });
			return `Double-clicked selector: "${selector}"`;
		}
		await locator.click({ force, timeout });
		return `Clicked selector: "${selector}"`;
	},

	/**
	 * Fill an input element by role and name or by selector.
	 * params: { text: string, role?: string, name?: string, selector?: string, timeout?: number }
	 */
	fill: async (app, params) => {
		const text = params.text;
		if (text === undefined) {
			throw new Error('fill requires a "text" param');
		}
		const timeout = params.timeout ?? 5000;
		if (params.selector) {
			await app.code.driver.page.locator(params.selector).fill(text, { timeout });
			return `Filled selector "${params.selector}" with: "${text.substring(0, 80)}"`;
		}
		const role = params.role ?? 'textbox';
		const options: Record<string, unknown> = {};
		if (params.name) {
			options.name = params.name;
		}
		await app.code.driver.page.getByRole(role as any, options).fill(text, { timeout });
		return `Filled ${role}${params.name ? ` "${params.name}"` : ''} with: "${text.substring(0, 80)}"`;
	},

	/**
	 * Press a keyboard key or shortcut.
	 * params: { key: string }
	 */
	press: async (app, params) => {
		const key = params.key;
		if (!key) {
			throw new Error('press requires a "key" param');
		}
		await app.code.driver.page.keyboard.press(key);
		return `Pressed: ${key}`;
	},

	/**
	 * Type text into the currently focused element using keyboard.type().
	 * Unlike `press` (single keys) or `fill` (replaces input value), this types
	 * each character sequentially -- works in Monaco editors, console input, etc.
	 * params: { text: string, delay?: number }
	 */
	type: async (app, params) => {
		const text = params.text;
		if (text === undefined || text === null) {
			throw new Error('type requires a "text" param');
		}
		const delay = params.delay ?? 0;
		await app.code.driver.page.keyboard.type(text, { delay });
		const preview = text.length > 60 ? text.substring(0, 57) + '...' : text;
		return `Typed: "${preview}"`;
	},

	/**
	 * Wait for text to appear anywhere on the page.
	 * params: { text: string, timeout?: number }
	 */
	waitForText: async (app, params) => {
		const text = params.text;
		if (!text) {
			throw new Error('waitForText requires a "text" param');
		}
		const timeout = params.timeout ?? 10000;
		await app.code.driver.page.getByText(text).waitFor({ state: 'visible', timeout });
		return `Text found: "${text}"`;
	},

	/**
	 * Wait for a CSS selector to appear on the page.
	 * params: { selector: string, state?: 'visible' | 'attached' | 'hidden', timeout?: number }
	 */
	waitForSelector: async (app, params) => {
		const selector = params.selector;
		if (!selector) {
			throw new Error('waitForSelector requires a "selector" param');
		}
		const state = params.state ?? 'visible';
		const timeout = params.timeout ?? 10000;
		await app.code.driver.page.locator(selector).waitFor({ state: state as any, timeout });
		return `Selector "${selector}" is ${state}`;
	},

	// =========================================================================
	// Escape Hatches (Tier 3)
	// =========================================================================

	/**
	 * Take a screenshot and return the path.
	 * params: { name?: string }
	 */
	takeScreenshot: async (app, params) => {
		const name = params.name ?? 'explore-screenshot';
		const screenshotPath = `/tmp/${name}-${Date.now()}.png`;
		await app.code.driver.page.screenshot({ path: screenshotPath });
		return `Screenshot saved: ${screenshotPath}`;
	},

	/**
	 * Evaluate JavaScript in the renderer process and return the result.
	 * params: { expression: string }
	 */
	evaluate: async (app, params) => {
		const expression = params.expression;
		if (!expression) {
			throw new Error('evaluate requires an "expression" param');
		}
		const result = await app.code.driver.page.evaluate(expression);
		return typeof result === 'string' ? result : JSON.stringify(result);
	},

	/**
	 * Resize the Electron window.
	 * params: { width: number, height: number }
	 */
	resizeWindow: async (app, params) => {
		const width = params.width;
		const height = params.height;
		if (!width || !height) {
			throw new Error('resizeWindow requires "width" and "height" params');
		}
		const electronApp = app.code.electronApp;
		if (!electronApp) {
			throw new Error('resizeWindow is only available in Electron mode');
		}
		await electronApp.evaluate(({ BrowserWindow }, { w, h }) => {
			const win = BrowserWindow.getAllWindows()[0];
			if (win) {
				win.setSize(w, h);
			}
		}, { w: width, h: height });
		await app.code.driver.page.waitForTimeout(500);
		return `Resized window to ${width}x${height}`;
	},

	/**
	 * Get the current Electron window size.
	 */
	getWindowSize: async (app, _params) => {
		const electronApp = app.code.electronApp;
		if (!electronApp) {
			throw new Error('getWindowSize is only available in Electron mode');
		}
		const size = await electronApp.evaluate(({ BrowserWindow }) => {
			const win = BrowserWindow.getAllWindows()[0];
			return win ? win.getSize() : [0, 0];
		});
		return JSON.stringify({ width: size[0], height: size[1] });
	},
};
