/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Code } from './code';
import { Interpreter } from '../infra/fixtures/interpreter';
import { Popups } from '../pages/popups';
import { Console } from '../pages/console';
import { Variables } from '../pages/variables';
import { DataExplorer } from '../pages/dataExplorer';
import { SideBar } from '../pages/sideBar';
import { Plots } from '../pages/plots';
import { Notebooks } from '../pages/notebooks';
import { NewProjectWizard } from '../pages/newProjectWizard';
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
import { Settings } from '../pages/settings';
import { Debug } from '../pages/debug';
import { EditorActionBar } from '../pages/editorActionBar';
import { Problems } from '../pages/problems';
import { References } from '../pages/references';
import { SCM } from '../pages/scm';

export interface Commands {
	runCommand(command: string, options?: { exactLabelMatch?: boolean }): Promise<any>;
}

export class Workbench {

	readonly interpreter: Interpreter;
	readonly popups: Popups;
	readonly console: Console;
	readonly variables: Variables;
	readonly dataExplorer: DataExplorer;
	readonly sideBar: SideBar;
	readonly plots: Plots;
	readonly notebooks: Notebooks;
	readonly newProjectWizard: NewProjectWizard;
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
	readonly settings: Settings;
	readonly debug: Debug;
	readonly editorActionBar: EditorActionBar;
	readonly problems: Problems;
	readonly references: References;
	readonly scm: SCM;

	constructor(code: Code) {

		this.popups = new Popups(code);
		this.variables = new Variables(code);
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
		this.newProjectWizard = new NewProjectWizard(code, this.quickaccess);
		this.output = new Output(code, this.quickaccess, this.quickInput);
		this.console = new Console(code, this.quickaccess, this.quickInput);
		this.interpreter = new Interpreter(code, this.console);
		this.notebooks = new Notebooks(code, this.quickInput, this.quickaccess);
		this.welcome = new Welcome(code);
		this.terminal = new Terminal(code, this.quickaccess);
		this.viewer = new Viewer(code);
		this.editor = new Editor(code);
		this.testExplorer = new TestExplorer(code);
		this.outline = new Outline(code, this.quickaccess);
		this.clipboard = new Clipboard(code);
		this.extensions = new Extensions(code, this.quickaccess);
		this.settings = new Settings(code, this.editors, this.editor, this.quickaccess);
		this.debug = new Debug(code);
		this.editorActionBar = new EditorActionBar(code.driver.page, this.viewer, this.quickaccess);
		this.problems = new Problems(code, this.quickaccess);
		this.references = new References(code);
		this.scm = new SCM(code, this.layouts);
		this.problems = new Problems(code, this.quickaccess);
	}
}

