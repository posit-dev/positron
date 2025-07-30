/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Code } from './code';
import { Modals } from '../pages/dialog-modals';
import { Toasts } from '../pages/dialog-toasts';
import { Popups } from '../pages/dialog-popups.js';
import { Console } from '../pages/console';
import { Variables } from '../pages/variables';
import { DataExplorer } from '../pages/dataExplorer';
import { SideBar } from '../pages/sideBar';
import { Plots } from '../pages/plots';
import { NewFolderFlow } from '../pages/newFolderFlow';
import { Explorer } from '../pages/explorer';
import { Connections } from '../pages/connections';
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

export interface Commands {
	runCommand(command: string, options?: { exactLabelMatch?: boolean }): Promise<any>;
}

export class Workbench {

	readonly modals: Modals;
	readonly toasts: Toasts;
	readonly popups: Popups;
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

	constructor(code: Code) {
		this.hotKeys = new HotKeys(code);
		this.toasts = new Toasts(code);
		this.popups = new Popups(code);
		this.variables = new Variables(code, this.hotKeys);
		this.dataExplorer = new DataExplorer(code, this);
		this.sideBar = new SideBar(code);
		this.plots = new Plots(code);
		this.explorer = new Explorer(code);
		this.help = new Help(code);
		this.topActionBar = new TopActionBar(code);
		this.layouts = new Layouts(code, this);
		this.quickInput = new QuickInput(code);
		this.editors = new Editors(code);
		this.quickaccess = new QuickAccess(code, this.editors, this.quickInput);
		this.connections = new Connections(code, this.quickaccess);
		this.newFolderFlow = new NewFolderFlow(code, this.quickaccess);
		this.output = new Output(code, this.quickaccess, this.quickInput);
		this.console = new Console(code, this.quickInput, this.quickaccess, this.hotKeys);
		this.modals = new Modals(code, this.toasts, this.console);
		this.sessions = new Sessions(code, this.quickaccess, this.quickInput, this.console);
		this.notebooks = new Notebooks(code, this.quickInput, this.quickaccess, this.hotKeys);
		this.notebooksVscode = new VsCodeNotebooks(code, this.quickInput, this.quickaccess, this.hotKeys);
		this.notebooksPositron = new PositronNotebooks(code, this.quickInput, this.quickaccess, this.hotKeys);
		this.welcome = new Welcome(code);
		this.clipboard = new Clipboard(code, this.hotKeys);
		this.terminal = new Terminal(code, this.quickaccess, this.clipboard);
		this.viewer = new Viewer(code);
		this.editor = new Editor(code);
		this.testExplorer = new TestExplorer(code);
		this.outline = new Outline(code, this.quickaccess);
		this.extensions = new Extensions(code, this.quickaccess);
		this.settings = new UserSettings(code, this.hotKeys);
		this.debug = new Debug(code);
		this.editorActionBar = new EditorActionBar(code.driver.page, this.viewer, this.quickaccess);
		this.problems = new Problems(code, this.quickaccess);
		this.references = new References(code);
		this.scm = new SCM(code, this.layouts);
		this.search = new Search(code);
		this.assistant = new Assistant(code, this.quickaccess, this.toasts);
		this.positConnect = new PositConnect(code);
	}
}
