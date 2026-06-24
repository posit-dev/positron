/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as playwright from 'playwright';
import { Code, createCodeFromPage } from './code';
import { Modals } from '../pages/dialog-modals';
import { Toasts } from '../pages/dialog-toasts';
import { Popups } from '../pages/dialog-popups.js';
import { ContextMenu } from '../pages/dialog-contextMenu.js';
import { Console } from '../pages/console';
import { Variables } from '../pages/variables';
import { DataExplorer } from '../pages/dataExplorer';
import { SideBar } from '../pages/sideBar';
import { Plots } from '../pages/plots';
import { NewFolderFlow } from '../pages/newFolderFlow';
import { Explorer } from '../pages/explorer';
import { Connections } from '../pages/connections';
import { DataConnections } from '../pages/dataConnections';
import { Help } from '../pages/help';
import { TopActionBar } from '../pages/topActionBar';
import { Layouts } from '../pages/layouts';
import { Output } from '../pages/output';
import { Welcome } from '../pages/welcome';
import { Terminal } from '../pages/terminal';
import { Viewer } from '../pages/viewer';
import { Editor } from '../pages/editor';
import { Editors } from '../pages/editors';
import { TestExplorer } from '../pages/testExplorer';
import { QuickAccess } from '../pages/quickaccess';
import { Outline } from '../pages/outline';
import { Clipboard } from '../pages/clipboard';
import { QuickInput } from '../pages/quickInput';
import { Extensions } from '../pages/extensions';
import { UserSettings } from '../pages/userSettings';
import { Debug } from '../pages/debug';
import { EditorActionBar } from '../pages/editorActionBar';
import { Problems } from '../pages/problems';
import { References } from '../pages/references';
import { SCM } from '../pages/scm';
import { Sessions } from '../pages/sessions';
import { Search } from '../pages/search.js';
import { Assistant } from '../pages/positronAssistant.js';
import { HotKeys } from '../pages/hotKeys.js';
import { PositConnect } from '../pages/connect.js';
import { Notebooks } from '../pages/notebooks.js';
import { PositronNotebooks } from '../pages/notebooksPositron.js';
import { VsCodeNotebooks } from '../pages/notebooksVscode.js';
import { PositAssistant } from '../pages/positAssistant.js';
import { ModelProviderAuth } from '../pages/modelProviderAuth.js';
import { InlineDataExplorer } from '../pages/inlineDataExplorer.js';
import { InlineQuarto } from '../pages/inlineQuarto.js';
import { Publisher } from '../pages/publisher.js';
import { Packages } from '../pages/packages.js';
import { SuggestWidget } from '../pages/suggestWidget.js';

export interface Commands {
	runCommand(command: string, options?: { exactLabelMatch?: boolean }): Promise<any>;
}

export class Workbench {

	readonly modals: Modals;
	readonly toasts: Toasts;
	readonly popups: Popups;
	readonly contextMenu: ContextMenu;
	readonly console: Console;
	readonly variables: Variables;
	readonly dataExplorer: DataExplorer;
	readonly sideBar: SideBar;
	readonly plots: Plots;
	readonly notebooks: Notebooks;
	readonly notebooksVscode: VsCodeNotebooks;
	readonly notebooksPositron: PositronNotebooks;
	readonly newFolderFlow: NewFolderFlow;
	readonly explorer: Explorer;
	readonly connections: Connections;
	readonly dataConnections: DataConnections;
	readonly help: Help;
	readonly topActionBar: TopActionBar;
	readonly layouts: Layouts;
	readonly output: Output;
	readonly welcome: Welcome;
	readonly terminal: Terminal;
	readonly viewer: Viewer;
	readonly editor: Editor;
	readonly testExplorer: TestExplorer;
	readonly quickaccess: QuickAccess;
	readonly outline: Outline;
	readonly clipboard: Clipboard;
	readonly quickInput: QuickInput;
	readonly extensions: Extensions;
	readonly editors: Editors;
	readonly settings: UserSettings;
	readonly debug: Debug;
	readonly editorActionBar: EditorActionBar;
	readonly problems: Problems;
	readonly references: References;
	readonly scm: SCM;
	readonly sessions: Sessions;
	readonly search: Search;
	readonly assistant: Assistant;
	readonly hotKeys: HotKeys;
	readonly positConnect: PositConnect;
	readonly positAssistant: PositAssistant;
	readonly modelProviderAuth: ModelProviderAuth;
	readonly inlineDataExplorer: InlineDataExplorer;
	readonly inlineQuarto: InlineQuarto;
	readonly publisher: Publisher;
	readonly packages: Packages;
	readonly suggestWidget: SuggestWidget;

	constructor(code: Code) {
		this.hotKeys = new HotKeys(code);
		this.toasts = new Toasts(code);
		this.popups = new Popups(code);
		this.contextMenu = new ContextMenu(code);
		this.variables = new Variables(code, this.hotKeys);
		this.dataExplorer = new DataExplorer(code, this);
		this.sideBar = new SideBar(code);
		this.plots = new Plots(code, this.contextMenu);
		this.explorer = new Explorer(code);
		this.help = new Help(code);
		this.topActionBar = new TopActionBar(code);
		this.layouts = new Layouts(code, this);
		this.quickInput = new QuickInput(code);
		this.editors = new Editors(code);
		this.quickaccess = new QuickAccess(code, this.editors, this.quickInput);
		this.connections = new Connections(code, this.quickaccess);
		this.dataConnections = new DataConnections(code, this.quickaccess);
		this.newFolderFlow = new NewFolderFlow(code, this.quickaccess);
		this.output = new Output(code, this.quickaccess, this.quickInput);
		this.console = new Console(code, this.quickInput, this.hotKeys, this.contextMenu);
		this.modals = new Modals(code, this.toasts, this.console);
		this.clipboard = new Clipboard(code, this.hotKeys);
		this.sessions = new Sessions(code, this.quickaccess, this.quickInput, this.console, this.contextMenu, this.modals);
		this.notebooks = new Notebooks(code, this.quickInput, this.quickaccess, this.hotKeys);
		this.notebooksVscode = new VsCodeNotebooks(code, this.quickInput, this.quickaccess, this.hotKeys);
		this.notebooksPositron = new PositronNotebooks(code, this.quickInput, this.quickaccess, this.hotKeys, this.contextMenu);
		this.welcome = new Welcome(code);
		this.terminal = new Terminal(code, this.quickaccess);
		this.viewer = new Viewer(code, this.contextMenu);
		this.editor = new Editor(code);
		this.testExplorer = new TestExplorer(code, this.quickaccess);
		this.outline = new Outline(code, this.quickaccess);
		this.extensions = new Extensions(code, this.quickaccess);
		this.settings = new UserSettings(code, this.hotKeys);
		this.debug = new Debug(code, this.hotKeys, this.quickaccess);
		this.editorActionBar = new EditorActionBar(code.driver.currentPage, this.viewer, this.quickaccess);
		this.problems = new Problems(code, this.quickaccess);
		this.references = new References(code);
		this.scm = new SCM(code, this.layouts);
		this.search = new Search(code);
		this.assistant = new Assistant(code, this.quickaccess, this.toasts, this.modals);
		this.positConnect = new PositConnect(code);
		this.positAssistant = new PositAssistant(code);
		this.modelProviderAuth = new ModelProviderAuth(code, this.modals, this.toasts);
		this.inlineDataExplorer = new InlineDataExplorer(code.driver.currentPage);
		this.inlineQuarto = new InlineQuarto(code, this.quickaccess, this.hotKeys);
		this.publisher = new Publisher(this.quickInput);
		this.packages = new Packages(code, this.contextMenu, this.quickInput, this.toasts, this.help);
		this.suggestWidget = new SuggestWidget(code);
	}
}

export function createWorkbenchFromPage(parentCode: Code, page: playwright.Page): Workbench {
	const code = createCodeFromPage(parentCode, page);
	return new Workbench(code);
}

/**
 * Waits for a new Electron window to appear, optionally running a trigger that opens it.
 *
 * Used by the remote backend tests (remote-ssh, remote-wsl) where connecting to a remote opens
 * the workbench in a fresh window. Pair the returned page with {@link createWorkbenchFromPage}.
 *
 * @param app The Electron application to watch for new windows.
 * @param trigger Optional action that opens the new window. Recommended so the listener is armed
 *   before the window appears.
 * @param opts.timeout How long to wait for the new window, in ms (default 30000).
 * @param opts.loadState The load state to wait for on the new page (default 'domcontentloaded').
 */
export async function waitForAnyNewWindow(
	app: playwright.ElectronApplication,
	trigger?: () => Promise<void> | void,
	opts: { timeout?: number; loadState?: 'load' | 'domcontentloaded' | 'networkidle' } = {}
): Promise<playwright.Page> {
	const { timeout = 30_000, loadState = 'domcontentloaded' } = opts;

	// Snapshot existing windows so we can detect a new one even if the event is missed.
	const before = new Set(app.windows());

	// Start waiting for a new 'window' event *before* we trigger anything.
	const eventWait = app.waitForEvent('window', { timeout }).catch(() => null);

	// Optionally run whatever opens the window (recommended).
	if (trigger) { await trigger(); }

	// If we caught the event, great.
	let win = await eventWait;

	// Fallback: CI flake where window opened before listener -- scan for any new page.
	if (!win) {
		const start = Date.now();
		while (Date.now() - start < timeout) {
			const current = app.windows();
			for (const p of current) {
				if (!before.has(p)) {
					win = p;
					break;
				}
			}
			if (win) { break; }
			await new Promise(r => setTimeout(r, 100));
		}
	}

	if (!win) { throw new Error('No new window appeared within timeout'); }

	// Ensure it's at least minimally ready and on top
	await win.waitForLoadState(loadState).catch(() => { });
	await win.bringToFront().catch(() => { });
	return win;
}
