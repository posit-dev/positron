/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// --- Start Positron ---
// This entire file has been updated to remove existing vscode imports, properties, POMs, etc
// Everything has been replaced with Positron code: .positron/<area>

import { Code } from './code';
import { InterpreterDropdown } from './positron/interpreterDropdown';
import { Popups } from './positron/popups';
import { Console } from './positron/console';
import { Variables } from './positron/variables';
import { DataExplorer } from './positron/dataExplorer';
import { SideBar } from './positron/sideBar';
import { Plots } from './positron/plots';
import { Notebooks } from './positron/notebooks';
import { NewProjectWizard } from './positron/newProjectWizard';
import { Explorer } from './positron/explorer';
import { Connections } from './positron/connections';
import { Help } from './positron/help';
import { TopActionBar } from './positron/topActionBar';
import { Layouts } from './positron/layouts';
import { Output } from './positron/output';
import { Welcome } from './positron/welcome';
import { Terminal } from './positron/terminal';
import { Viewer } from './positron/viewer';
import { Editor } from './positron/editor';
import { Editors } from './positron/editors';
import { TestExplorer } from './positron/testExplorer';
import { QuickAccess } from './positron/quickaccess';
import { Outline } from './positron/outline';
import { Clipboard } from './positron/clipboard';
import { QuickInput } from './positron/quickInput';
import { Extensions } from './positron/extensions';
import { Settings } from './positron/settings';

export interface Commands {
	runCommand(command: string, options?: { exactLabelMatch?: boolean }): Promise<any>;
}

export class Workbench {

	readonly interpreterDropdown: InterpreterDropdown;
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

	constructor(code: Code) {

		this.popups = new Popups(code);
		this.interpreterDropdown = new InterpreterDropdown(code);
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
	}
}
// --- End Positron ---
