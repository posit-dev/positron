/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import { Application } from '../../infra/application';

type ActionFn = (app: Application, params: Record<string, any>) => Promise<string>;

export const actionCatalog: Record<string, ActionFn> = {

	// =========================================================================
	// Sessions
	// =========================================================================

	/**
	 * Start a language session (Python or R).
	 * params: { language: 'python' | 'r' }
	 */
	startSession: async (app, params) => {
		const language = params.language ?? 'python';
		await app.workbench.sessions.start(language, { reuse: true });
		return `Started ${language} session`;
	},

	/**
	 * Restart the current session.
	 * params: { sessionId?: string, waitForReady?: boolean }
	 */
	restartSession: async (app, params) => {
		const sessionId = params.sessionId;
		const waitForIdle = params.waitForIdle ?? true;
		await app.workbench.sessions.restart(sessionId, { waitForIdle });
		return `Restarted session${sessionId ? ` ${sessionId}` : ''}`;
	},

	/**
	 * Delete all sessions.
	 * params: {} (none required)
	 */
	deleteAllSessions: async (app, _params) => {
		await app.workbench.sessions.deleteAll();
		return 'Deleted all sessions';
	},

	/**
	 * Select a session by ID or name.
	 * params: { session: string, waitForIdle?: boolean }
	 */
	selectSession: async (app, params) => {
		const session = params.session;
		if (!session) {
			throw new Error('selectSession requires a "session" param');
		}
		const waitForIdle = params.waitForIdle ?? true;
		await app.workbench.sessions.select(session, waitForIdle);
		return `Selected session: ${session}`;
	},

	/**
	 * Get the number of sessions in the console.
	 * params: {} (none required)
	 */
	getSessionCount: async (app, _params) => {
		const count = await app.workbench.sessions.getSessionCount();
		return `Session count: ${count}`;
	},

	/**
	 * Verify all sessions are ready (idle or disconnected).
	 * params: { timeout?: number }
	 */
	expectAllSessionsReady: async (app, params) => {
		const timeout = params.timeout ?? 30000;
		await app.workbench.sessions.expectAllSessionsToBeReady({ timeout });
		return 'All sessions are ready';
	},

	// =========================================================================
	// Console
	// =========================================================================

	/**
	 * Execute code in the console.
	 * params: { language: 'Python' | 'R', code: string, timeout?: number }
	 */
	executeCode: async (app, params) => {
		const language = params.language ?? 'Python';
		const code = params.code;
		if (!code) {
			throw new Error('executeCode requires a "code" param');
		}
		const timeout = params.timeout ?? 10000;
		await app.workbench.console.executeCode(language, code, {
			timeout,
			waitForReady: true,
			maximizeConsole: false,
		});
		return `Executed: ${code.substring(0, 80)}`;
	},

	/**
	 * Wait for text or regex to appear in the console output.
	 * params: { text: string, timeout?: number }
	 */
	expectConsoleOutput: async (app, params) => {
		const text = params.text;
		if (!text) {
			throw new Error('expectConsoleOutput requires a "text" param');
		}
		const timeout = params.timeout ?? 10000;
		await app.workbench.console.waitForConsoleContents(text, { timeout });
		return `Console contains: "${text.substring(0, 80)}"`;
	},

	/**
	 * Paste code into the console (useful for multi-line code).
	 * params: { code: string, execute?: boolean }
	 */
	pasteToConsole: async (app, params) => {
		const code = params.code;
		if (!code) {
			throw new Error('pasteToConsole requires a "code" param');
		}
		const execute = params.execute ?? false;
		await app.workbench.console.pasteCodeToConsole(code, execute);
		return `Pasted to console${execute ? ' and executed' : ''}: ${code.substring(0, 80)}`;
	},

	/**
	 * Type text into the console input.
	 * params: { text: string, pressEnter?: boolean }
	 */
	typeToConsole: async (app, params) => {
		const text = params.text;
		if (!text) {
			throw new Error('typeToConsole requires a "text" param');
		}
		const pressEnter = params.pressEnter ?? false;
		await app.workbench.console.typeToConsole(text, pressEnter);
		return `Typed to console: ${text.substring(0, 80)}`;
	},

	/**
	 * Wait for the console to be ready with a prompt.
	 * params: { prompt?: string, timeout?: number }
	 */
	waitForConsoleReady: async (app, params) => {
		const prompt = params.prompt ?? '>>>';
		const timeout = params.timeout ?? 30000;
		await app.workbench.console.waitForReady(prompt, timeout);
		return `Console ready with prompt: ${prompt}`;
	},

	/**
	 * Send Enter key to the console.
	 * params: {} (none required)
	 */
	consoleSendEnter: async (app, _params) => {
		await app.workbench.console.sendEnterKey();
		return 'Sent Enter to console';
	},

	/**
	 * Clear the console input.
	 * params: {} (none required)
	 */
	clearConsoleInput: async (app, _params) => {
		await app.workbench.console.clearInput();
		return 'Cleared console input';
	},

	/**
	 * Maximize the console panel.
	 * params: {} (none required)
	 */
	maximizeConsole: async (app, _params) => {
		await app.workbench.console.maximizeConsole();
		return 'Maximized console';
	},

	/**
	 * Interrupt the current execution.
	 * params: {} (none required)
	 */
	interruptExecution: async (app, _params) => {
		await app.workbench.console.interruptExecution();
		return 'Interrupted execution';
	},

	/**
	 * Verify the console contains an error message.
	 * params: { error: string }
	 */
	expectConsoleError: async (app, params) => {
		const error = params.error;
		if (!error) {
			throw new Error('expectConsoleError requires an "error" param');
		}
		await app.workbench.console.expectConsoleToContainError(error);
		return `Console contains error: "${error.substring(0, 80)}"`;
	},

	/**
	 * Focus the console.
	 * params: {} (none required)
	 */
	focusConsole: async (app, _params) => {
		await app.workbench.console.focus();
		return 'Focused console';
	},

	// =========================================================================
	// Variables
	// =========================================================================

	/**
	 * Check that a variable exists with an expected value.
	 * params: { name: string, value?: string, timeout?: number }
	 */
	expectVariable: async (app, params) => {
		const name = params.name;
		if (!name) {
			throw new Error('expectVariable requires a "name" param');
		}
		const value = params.value;
		const timeout = params.timeout ?? 10000;
		if (value) {
			await app.workbench.variables.expectVariableToBe(name, value, timeout);
			return `Variable "${name}" = ${value}`;
		}
		await app.workbench.variables.waitForVariableRow(name);
		return `Variable "${name}" exists`;
	},

	/**
	 * Verify a variable does not exist.
	 * params: { name: string }
	 */
	expectVariableNotExist: async (app, params) => {
		const name = params.name;
		if (!name) {
			throw new Error('expectVariableNotExist requires a "name" param');
		}
		await app.workbench.variables.expectVariableToNotExist(name);
		return `Variable "${name}" does not exist`;
	},

	/**
	 * Open a variable in the Data Explorer by double-clicking it in the Variables pane.
	 * params: { name: string }
	 */
	openInDataExplorer: async (app, params) => {
		const name = params.name;
		if (!name) {
			throw new Error('openInDataExplorer requires a "name" param');
		}
		await app.workbench.variables.doubleClickVariableRow(name);
		return `Opened "${name}" in Data Explorer`;
	},

	/**
	 * Expand or collapse a variable in the Variables pane.
	 * params: { name: string, action: 'expand' | 'collapse' }
	 */
	toggleVariable: async (app, params) => {
		const name = params.name;
		if (!name) {
			throw new Error('toggleVariable requires a "name" param');
		}
		const action = params.action ?? 'expand';
		await app.workbench.variables.toggleVariable({ variableName: name, action });
		return `${action === 'expand' ? 'Expanded' : 'Collapsed'} variable "${name}"`;
	},

	/**
	 * Delete all variables from the Variables pane.
	 * params: {} (none required)
	 */
	deleteAllVariables: async (app, _params) => {
		await app.workbench.variables.clickDeleteAllVariables();
		return 'Deleted all variables';
	},

	/**
	 * Click the database icon for a variable row (opens connection explorer).
	 * params: { name: string }
	 */
	clickDatabaseIcon: async (app, params) => {
		const name = params.name;
		if (!name) {
			throw new Error('clickDatabaseIcon requires a "name" param');
		}
		await app.workbench.variables.clickDatabaseIconForVariableRow(name);
		return `Clicked database icon for "${name}"`;
	},

	// =========================================================================
	// Data Explorer
	// =========================================================================

	/**
	 * Sort a column in the Data Explorer.
	 * params: { columnIndex: number, direction: 'Sort Ascending' | 'Sort Descending' | 'Clear Sorting' }
	 */
	sortColumn: async (app, params) => {
		const columnIndex = params.columnIndex;
		if (columnIndex === undefined) {
			throw new Error('sortColumn requires a "columnIndex" param (1-based)');
		}
		const direction = params.direction ?? 'Sort Ascending';
		await app.workbench.dataExplorer.grid.sortColumnBy(columnIndex, direction);
		return `Sorted column ${columnIndex}: ${direction}`;
	},

	/**
	 * Verify cell content at a specific position in the Data Explorer.
	 * params: { rowIndex: number, colIndex: number, value: string }
	 */
	expectCellValue: async (app, params) => {
		const { rowIndex, colIndex, value } = params;
		if (rowIndex === undefined || colIndex === undefined || value === undefined) {
			throw new Error('expectCellValue requires "rowIndex", "colIndex", and "value" params');
		}
		await app.workbench.dataExplorer.grid.expectCellContentToBe({ rowIndex, colIndex, value });
		return `Cell [${rowIndex},${colIndex}] = "${value}"`;
	},

	/**
	 * Verify the Data Explorer has the expected number of rows.
	 * params: { count: number }
	 */
	expectRowCount: async (app, params) => {
		const count = params.count;
		if (count === undefined) {
			throw new Error('expectRowCount requires a "count" param');
		}
		await app.workbench.dataExplorer.grid.verifyTableDataLength(count);
		return `Data Explorer has ${count} rows`;
	},

	/**
	 * Verify the Data Explorer column headers match expected values.
	 * params: { headers: string[] }
	 */
	expectColumnHeaders: async (app, params) => {
		const headers = params.headers;
		if (!headers || !Array.isArray(headers)) {
			throw new Error('expectColumnHeaders requires a "headers" array param');
		}
		await app.workbench.dataExplorer.grid.expectColumnHeadersToBe(headers);
		return `Column headers match: ${headers.join(', ')}`;
	},

	/**
	 * Verify the row order in the Data Explorer.
	 * params: { expectedOrder: number[] }
	 */
	expectRowOrder: async (app, params) => {
		const expectedOrder = params.expectedOrder;
		if (!expectedOrder || !Array.isArray(expectedOrder)) {
			throw new Error('expectRowOrder requires an "expectedOrder" array param');
		}
		await app.workbench.dataExplorer.grid.expectRowOrderToBe(expectedOrder);
		return `Row order matches: ${expectedOrder.join(', ')}`;
	},

	/**
	 * Add a filter to the Data Explorer.
	 * params: { columnName: string, condition: string, value?: string }
	 */
	addDataFilter: async (app, params) => {
		const columnName = params.columnName;
		const condition = params.condition;
		if (!columnName || !condition) {
			throw new Error('addDataFilter requires "columnName" and "condition" params');
		}
		await app.workbench.dataExplorer.filters.add({
			columnName,
			condition,
			value: params.value,
		});
		return `Added filter: ${columnName} ${condition}${params.value ? ` ${params.value}` : ''}`;
	},

	/**
	 * Clear all filters and sorting in the Data Explorer.
	 * params: {} (none required)
	 */
	clearAllFilters: async (app, _params) => {
		await app.workbench.dataExplorer.filters.clearAll();
		return 'Cleared all filters and sorting';
	},

	/**
	 * Maximize the Data Explorer view.
	 * params: { showSummaryPanel?: boolean }
	 */
	maximizeDataExplorer: async (app, params) => {
		const showSummaryPanel = params.showSummaryPanel ?? false;
		await app.workbench.dataExplorer.maximize(showSummaryPanel);
		return `Maximized Data Explorer${showSummaryPanel ? ' with summary panel' : ''}`;
	},

	/**
	 * Verify the Data Explorer status bar text.
	 * params: { text: string, timeout?: number }
	 */
	expectDataExplorerStatus: async (app, params) => {
		const text = params.text;
		if (!text) {
			throw new Error('expectDataExplorerStatus requires a "text" param');
		}
		const timeout = params.timeout ?? 10000;
		await app.workbench.dataExplorer.expectStatusBarToHaveText(text, timeout);
		return `Data Explorer status bar: "${text}"`;
	},

	/**
	 * Click a cell in the Data Explorer by position.
	 * params: { rowPosition: number, columnPosition: number }
	 */
	clickDataCell: async (app, params) => {
		const { rowPosition, columnPosition } = params;
		if (rowPosition === undefined || columnPosition === undefined) {
			throw new Error('clickDataCell requires "rowPosition" and "columnPosition" params');
		}
		await app.workbench.dataExplorer.grid.clickCell(rowPosition, columnPosition);
		return `Clicked cell [${rowPosition},${columnPosition}]`;
	},

	/**
	 * Get all data from the Data Explorer grid.
	 * params: {} (none required)
	 */
	getDataExplorerData: async (app, _params) => {
		const data = await app.workbench.dataExplorer.grid.getData();
		return JSON.stringify(data).substring(0, 3000);
	},

	/**
	 * Get the column headers from the Data Explorer.
	 * params: {} (none required)
	 */
	getColumnHeaders: async (app, _params) => {
		const headers = await app.workbench.dataExplorer.grid.getColumnHeaders();
		return `Column headers: ${headers.join(', ')}`;
	},

	// =========================================================================
	// Plots
	// =========================================================================

	/**
	 * Wait for a plot to appear in the Plots pane.
	 * params: { timeout?: number }
	 */
	waitForPlot: async (app, _params) => {
		await app.workbench.plots.waitForCurrentPlot();
		return 'Plot appeared';
	},

	/**
	 * Wait for a static plot to appear.
	 * params: {} (none required)
	 */
	waitForStaticPlot: async (app, _params) => {
		await app.workbench.plots.waitForCurrentStaticPlot();
		return 'Static plot appeared';
	},

	/**
	 * Verify the number of plot thumbnails.
	 * params: { count: number }
	 */
	expectPlotCount: async (app, params) => {
		const count = params.count;
		if (count === undefined) {
			throw new Error('expectPlotCount requires a "count" param');
		}
		await app.workbench.plots.expectPlotThumbnailsCountToBe(count);
		return `Plot count: ${count}`;
	},

	/**
	 * Clear all plots.
	 * params: {} (none required)
	 */
	clearPlots: async (app, _params) => {
		await app.workbench.plots.clearPlots();
		return 'Cleared all plots';
	},

	/**
	 * Wait for all plots to disappear.
	 * params: { timeout?: number }
	 */
	waitForNoPlots: async (app, params) => {
		const timeout = params.timeout ?? 10000;
		await app.workbench.plots.waitForNoPlots({ timeout });
		return 'No plots visible';
	},

	/**
	 * Save a plot from the Plots pane.
	 * params: { name: string, format: 'PNG' | 'JPEG' | 'SVG' | 'TIFF' | 'BMP' | 'PDF', overwrite?: boolean }
	 */
	savePlot: async (app, params) => {
		const name = params.name;
		const format = params.format ?? 'PNG';
		if (!name) {
			throw new Error('savePlot requires a "name" param');
		}
		const overwrite = params.overwrite ?? false;
		await app.workbench.plots.savePlotFromPlotsPane({ name, format, overwrite });
		return `Saved plot: ${name}.${format.toLowerCase()}`;
	},

	/**
	 * Set the plot zoom level.
	 * params: { zoom: 'Fit' | '50%' | '75%' | '100%' | '200%' }
	 */
	setPlotZoom: async (app, params) => {
		const zoom = params.zoom ?? '100%';
		await app.workbench.plots.setThePlotZoom(zoom);
		return `Set plot zoom: ${zoom}`;
	},

	/**
	 * Open the current plot in a different location.
	 * params: { location: 'Editor' | 'New Window' | 'Editor Tab to the Side' }
	 */
	openPlotIn: async (app, params) => {
		const location = params.location ?? 'Editor';
		await app.workbench.plots.openPlotIn(location);
		return `Opened plot in: ${location}`;
	},

	/**
	 * Wait for a webview-based plot (e.g., plotly, bokeh).
	 * params: { selector?: string, state?: 'attached' | 'visible' }
	 */
	waitForWebviewPlot: async (app, params) => {
		const selector = params.selector ?? '.plot-instance';
		const state = params.state ?? 'visible';
		await app.workbench.plots.waitForWebviewPlot(selector, state);
		return `Webview plot is ${state}`;
	},

	// =========================================================================
	// Quick Access / Files
	// =========================================================================

	/**
	 * Run a VS Code command via the command palette.
	 * params: { command: string }
	 */
	runCommand: async (app, params) => {
		const command = params.command;
		if (!command) {
			throw new Error('runCommand requires a "command" param');
		}
		await app.workbench.quickaccess.runCommand(command);
		return `Ran command: ${command}`;
	},

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
		await app.workbench.quickaccess.openFile(fullPath);
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
		await app.workbench.quickaccess.openDataFile(fullPath);
		return `Opened data file: ${filePath}`;
	},

	// =========================================================================
	// Editor
	// =========================================================================

	/**
	 * Type text in the editor.
	 * params: { text: string, pressEnter?: boolean }
	 */
	editorType: async (app, params) => {
		const text = params.text;
		if (!text) {
			throw new Error('editorType requires a "text" param');
		}
		const pressEnter = params.pressEnter ?? false;
		await app.workbench.editor.type(text, pressEnter);
		return `Typed in editor: ${text.substring(0, 80)}`;
	},

	/**
	 * Select an editor tab and type text.
	 * params: { filename: string, text: string }
	 */
	editorSelectAndType: async (app, params) => {
		const { filename, text } = params;
		if (!filename || !text) {
			throw new Error('editorSelectAndType requires "filename" and "text" params');
		}
		await app.workbench.editor.selectTabAndType(filename, text);
		return `Selected "${filename}" and typed: ${text.substring(0, 80)}`;
	},

	/**
	 * Click the play/run button in the editor.
	 * params: {} (none required)
	 */
	editorPressPlay: async (app, _params) => {
		await app.workbench.editor.pressPlay();
		return 'Pressed play button in editor';
	},

	/**
	 * Wait for editor content to match a condition.
	 * params: { filename: string, text: string, timeout?: number }
	 */
	expectEditorContent: async (app, params) => {
		const { filename, text } = params;
		if (!filename || !text) {
			throw new Error('expectEditorContent requires "filename" and "text" params');
		}
		await app.workbench.editor.waitForEditorContents(filename, (content: string) => content.includes(text));
		return `Editor "${filename}" contains: "${text.substring(0, 80)}"`;
	},

	/**
	 * Get a specific line from the editor.
	 * params: { filename: string, line: number }
	 */
	getEditorLine: async (app, params) => {
		const { filename, line } = params;
		if (!filename || line === undefined) {
			throw new Error('getEditorLine requires "filename" and "line" params');
		}
		const content = await app.workbench.editor.getLine(filename, line);
		return `Line ${line}: ${content}`;
	},

	// =========================================================================
	// Editor Tabs
	// =========================================================================

	/**
	 * Click an editor tab by name.
	 * params: { name: string }
	 */
	clickTab: async (app, params) => {
		const name = params.name;
		if (!name) {
			throw new Error('clickTab requires a "name" param');
		}
		await app.workbench.editors.clickTab(name);
		return `Clicked tab: ${name}`;
	},

	/**
	 * Verify an editor tab exists and optionally is selected.
	 * params: { name: string, isVisible?: boolean, isSelected?: boolean }
	 */
	expectTab: async (app, params) => {
		const name = params.name;
		if (!name) {
			throw new Error('expectTab requires a "name" param');
		}
		await app.workbench.editors.verifyTab(name, {
			isVisible: params.isVisible,
			isSelected: params.isSelected,
		});
		return `Tab "${name}" verified`;
	},

	/**
	 * Wait for an editor tab to be active.
	 * params: { filename: string }
	 */
	waitForActiveTab: async (app, params) => {
		const filename = params.filename;
		if (!filename) {
			throw new Error('waitForActiveTab requires a "filename" param');
		}
		await app.workbench.editors.waitForActiveTab(filename);
		return `Tab "${filename}" is active`;
	},

	/**
	 * Create a new untitled file.
	 * params: {} (none required)
	 */
	newUntitledFile: async (app, _params) => {
		await app.workbench.editors.newUntitledFile();
		return 'Created new untitled file';
	},

	/**
	 * Save the currently open file.
	 * params: {} (none required)
	 */
	saveFile: async (app, _params) => {
		await app.workbench.editors.saveOpenedFile();
		return 'Saved file';
	},

	/**
	 * Save the current file with a new name.
	 * Accepts workspace-relative paths (e.g., "newfile.txt") or absolute paths.
	 * params: { path: string }
	 */
	saveFileAs: async (app, params) => {
		const filePath = params.path;
		if (!filePath) {
			throw new Error('saveFileAs requires a "path" param');
		}
		const fullPath = path.isAbsolute(filePath) ? filePath : path.join(app.workspacePathOrFolder, filePath);
		await app.workbench.quickaccess.runCommand('workbench.action.files.saveAs', { keepOpen: true });
		await app.workbench.quickInput.waitForQuickInputOpened();
		await app.workbench.quickInput.type(fullPath);
		await app.workbench.quickInput.clickOkButton();
		return `Saved file as: ${filePath}`;
	},

	// =========================================================================
	// Settings
	// =========================================================================

	/**
	 * Set one or more IDE settings.
	 * params: { settings: Record<string, unknown>, reload?: boolean }
	 */
	setSetting: async (app, params) => {
		const newSettings = params.settings;
		if (!newSettings || typeof newSettings !== 'object') {
			throw new Error('setSetting requires a "settings" object param');
		}
		const reload = params.reload ?? false;
		await app.workbench.settings.set(newSettings as Record<string, unknown>);
		if (reload) {
			await app.workbench.hotKeys.reloadWindow(false);
			await app.code.driver.page.waitForTimeout(3000);
			await app.code.driver.page.locator('.monaco-workbench').waitFor({ state: 'visible' });
		}
		return `Set settings: ${Object.keys(newSettings).join(', ')}${reload ? ' (reloaded)' : ''}`;
	},

	/**
	 * Clear all custom settings (restore defaults).
	 * params: {} (none required)
	 */
	clearSettings: async (app, _params) => {
		await app.workbench.settings.clear();
		return 'Cleared all settings';
	},

	/**
	 * Remove specific settings by key.
	 * params: { keys: string[] }
	 */
	removeSettings: async (app, params) => {
		const keys = params.keys;
		if (!keys || !Array.isArray(keys)) {
			throw new Error('removeSettings requires a "keys" array param');
		}
		await app.workbench.settings.remove(keys);
		return `Removed settings: ${keys.join(', ')}`;
	},

	// =========================================================================
	// Hot Keys
	// =========================================================================

	/**
	 * Copy selected content to clipboard.
	 * params: {} (none required)
	 */
	copy: async (app, _params) => {
		await app.workbench.hotKeys.copy();
		return 'Copied to clipboard';
	},

	/**
	 * Cut selected content to clipboard.
	 * params: {} (none required)
	 */
	cut: async (app, _params) => {
		await app.workbench.hotKeys.cut();
		return 'Cut to clipboard';
	},

	/**
	 * Paste clipboard contents.
	 * params: {} (none required)
	 */
	paste: async (app, _params) => {
		await app.workbench.hotKeys.paste();
		return 'Pasted from clipboard';
	},

	/**
	 * Undo the last action.
	 * params: {} (none required)
	 */
	undo: async (app, _params) => {
		await app.workbench.hotKeys.undo();
		return 'Undone last action';
	},

	/**
	 * Redo the last undone action.
	 * params: {} (none required)
	 */
	redo: async (app, _params) => {
		await app.workbench.hotKeys.redo();
		return 'Redone last action';
	},

	/**
	 * Select all content.
	 * params: {} (none required)
	 */
	selectAll: async (app, _params) => {
		await app.workbench.hotKeys.selectAll();
		return 'Selected all';
	},

	/**
	 * Close all open editors.
	 * params: {} (none required)
	 */
	closeAllEditors: async (app, _params) => {
		await app.workbench.hotKeys.closeAllEditors();
		return 'Closed all editors';
	},

	/**
	 * Close the current editor tab.
	 * params: {} (none required)
	 */
	closeTab: async (app, _params) => {
		await app.workbench.hotKeys.closeTab();
		return 'Closed current tab';
	},

	/**
	 * Open the find dialog.
	 * params: {} (none required)
	 */
	find: async (app, _params) => {
		await app.workbench.hotKeys.find();
		return 'Opened find dialog';
	},

	/**
	 * Focus the console panel via hotkey.
	 * params: {} (none required)
	 */
	focusConsoleHotKey: async (app, _params) => {
		await app.workbench.hotKeys.focusConsole();
		return 'Focused console via hotkey';
	},

	/**
	 * Toggle the bottom panel visibility.
	 * params: {} (none required)
	 */
	toggleBottomPanel: async (app, _params) => {
		await app.workbench.hotKeys.toggleBottomPanel();
		return 'Toggled bottom panel';
	},

	/**
	 * Show the secondary sidebar.
	 * params: {} (none required)
	 */
	showSecondarySidebar: async (app, _params) => {
		await app.workbench.hotKeys.showSecondarySidebar();
		return 'Showed secondary sidebar';
	},

	/**
	 * Close the secondary sidebar.
	 * params: {} (none required)
	 */
	closeSecondarySidebar: async (app, _params) => {
		await app.workbench.hotKeys.closeSecondarySidebar();
		return 'Closed secondary sidebar';
	},

	/**
	 * Close the primary sidebar.
	 * params: {} (none required)
	 */
	closePrimarySidebar: async (app, _params) => {
		await app.workbench.hotKeys.closePrimarySidebar();
		return 'Closed primary sidebar';
	},

	/**
	 * Minimize the bottom panel.
	 * params: {} (none required)
	 */
	minimizeBottomPanel: async (app, _params) => {
		await app.workbench.hotKeys.minimizeBottomPanel();
		return 'Minimized bottom panel';
	},

	/**
	 * Restore the bottom panel to its previous size.
	 * params: {} (none required)
	 */
	restoreBottomPanel: async (app, _params) => {
		await app.workbench.hotKeys.restoreBottomPanel();
		return 'Restored bottom panel';
	},

	/**
	 * Reload the window.
	 * params: { waitForReady?: boolean }
	 */
	reloadWindow: async (app, params) => {
		const waitForReady = params.waitForReady ?? true;
		await app.workbench.hotKeys.reloadWindow(waitForReady);
		if (waitForReady) {
			await app.code.driver.page.waitForTimeout(3000);
			await app.code.driver.page.locator('.monaco-workbench').waitFor({ state: 'visible' });
		}
		return `Reloaded window${waitForReady ? ' (waited for ready)' : ''}`;
	},

	/**
	 * Execute a notebook cell via hotkey.
	 * params: {} (none required)
	 */
	executeNotebookCell: async (app, _params) => {
		await app.workbench.hotKeys.executeNotebookCell();
		return 'Executed notebook cell';
	},

	/**
	 * Run the current file in the console.
	 * params: {} (none required)
	 */
	runFileInConsole: async (app, _params) => {
		await app.workbench.hotKeys.runFileInConsole();
		return 'Ran file in console';
	},

	/**
	 * Run the current line of code in the console.
	 * params: {} (none required)
	 */
	runLineOfCode: async (app, _params) => {
		await app.workbench.hotKeys.runLineOfCode();
		return 'Ran line of code';
	},

	/**
	 * Send interrupt signal to the console.
	 * params: {} (none required)
	 */
	sendInterrupt: async (app, _params) => {
		await app.workbench.hotKeys.sendInterrupt();
		return 'Sent interrupt';
	},

	/**
	 * Format the current document.
	 * params: {} (none required)
	 */
	formatDocument: async (app, _params) => {
		await app.workbench.hotKeys.formatDocument();
		return 'Formatted document';
	},

	/**
	 * Clear all breakpoints.
	 * params: {} (none required)
	 */
	clearAllBreakpoints: async (app, _params) => {
		await app.workbench.hotKeys.clearAllBreakpoints();
		return 'Cleared all breakpoints';
	},

	/**
	 * Show the Data Explorer summary panel.
	 * params: {} (none required)
	 */
	showDataExplorerSummaryPanel: async (app, _params) => {
		await app.workbench.hotKeys.showDataExplorerSummaryPanel();
		return 'Showed Data Explorer summary panel';
	},

	/**
	 * Hide the Data Explorer summary panel.
	 * params: {} (none required)
	 */
	hideDataExplorerSummaryPanel: async (app, _params) => {
		await app.workbench.hotKeys.hideDataExplorerSummaryPanel();
		return 'Hid Data Explorer summary panel';
	},

	/**
	 * Kill all terminals.
	 * params: {} (none required)
	 */
	killAllTerminals: async (app, _params) => {
		await app.workbench.hotKeys.killAllTerminals();
		return 'Killed all terminals';
	},

	// =========================================================================
	// Notebooks
	// =========================================================================

	/**
	 * Create a new Positron notebook.
	 * Automatically enables Positron notebooks (with reload) if needed.
	 * params: { codeCells?: number, markdownCells?: number }
	 */
	newNotebook: async (app, params) => {
		// Enable Positron notebooks with reload (required for the setting to take effect)
		await app.workbench.settings.set({ 'positron.notebook.enabled': true });
		await app.workbench.hotKeys.reloadWindow(false);
		await app.code.driver.page.waitForTimeout(3000);
		await app.code.driver.page.locator('.monaco-workbench').waitFor({ state: 'visible' });
		const codeCells = params.codeCells ?? 1;
		const markdownCells = params.markdownCells ?? 0;
		await app.workbench.notebooksPositron.newNotebook({ codeCells, markdownCells });
		return `Created notebook with ${codeCells} code cell(s) and ${markdownCells} markdown cell(s)`;
	},

	/**
	 * Add code to a notebook cell and optionally run it.
	 * params: { cellIndex: number, code: string, run?: boolean }
	 */
	addCodeToCell: async (app, params) => {
		const cellIndex = params.cellIndex ?? 0;
		const code = params.code;
		if (!code) {
			throw new Error('addCodeToCell requires a "code" param');
		}
		const run = params.run ?? false;
		await app.workbench.notebooksPositron.addCodeToCell(cellIndex, code, { run });
		return run ? `Added and ran code in cell ${cellIndex}` : `Added code to cell ${cellIndex}`;
	},

	/**
	 * Add a new cell to the notebook.
	 * params: { type: 'code' | 'markdown' }
	 */
	addCell: async (app, params) => {
		const type = params.type ?? 'code';
		await app.workbench.notebooksPositron.addCell(type);
		return `Added ${type} cell`;
	},

	/**
	 * Verify cell output contains expected text.
	 * params: { cellIndex: number, expectedLines: string[] }
	 */
	expectCellOutput: async (app, params) => {
		const cellIndex = params.cellIndex ?? 0;
		const expectedLines = params.expectedLines;
		if (!expectedLines || !Array.isArray(expectedLines)) {
			throw new Error('expectCellOutput requires an "expectedLines" array param');
		}
		await app.workbench.notebooksPositron.expectOutputAtIndex(cellIndex, expectedLines);
		return `Cell ${cellIndex} output matches expected`;
	},

	/**
	 * Verify the notebook has the expected number of cells.
	 * params: { count: number }
	 */
	expectCellCount: async (app, params) => {
		const count = params.count;
		if (count === undefined) {
			throw new Error('expectCellCount requires a "count" param');
		}
		await app.workbench.notebooksPositron.expectCellCountToBe(count);
		return `Notebook has ${count} cell(s)`;
	},

	/**
	 * Select a notebook kernel.
	 * params: { kernelGroup: 'Python' | 'R', waitForReady?: boolean }
	 */
	selectKernel: async (app, params) => {
		const kernelGroup = params.kernelGroup ?? 'Python';
		const waitForReady = params.waitForReady ?? true;
		await app.workbench.notebooksPositron.kernel.select(kernelGroup, { waitForReady });
		return `Selected ${kernelGroup} kernel`;
	},

	// =========================================================================
	// Raw Playwright actions (adaptive layer)
	// =========================================================================

	/**
	 * Take an accessibility snapshot of the current page.
	 * Returns the aria tree so the AI can see the full UI state and find elements.
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
	// General
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
};
