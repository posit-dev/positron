/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Explorer } from './explorer';
import { ActivityBar } from './activityBar';
import { QuickAccess } from './quickaccess';
import { QuickInput } from './quickinput';
import { Extensions } from './extensions';
import { Search } from './search';
import { Editor } from './editor';
import { SCM } from './scm';
import { Debug } from './debug';
import { StatusBar } from './statusbar';
import { Problems } from './problems';
import { SettingsEditor } from './settings';
import { KeybindingsEditor } from './keybindings';
import { Editors } from './editors';
import { Code } from './code';
import { Terminal } from './terminal';
import { Notebook } from './notebook';
import { Localization } from './localization';
import { Task } from './task';

// --- Start Positron ---
import { PositronInterpreterDropdown } from './positron/positronInterpreterDropdown';
import { PositronPopups } from './positron/positronPopups';
import { PositronConsole } from './positron/positronConsole';
import { PositronVariables } from './positron/positronVariables';
import { PositronDataExplorer } from './positron/positronDataExplorer';
import { PositronSideBar } from './positron/positronSideBar';
import { PositronPlots } from './positron/positronPlots';
import { PositronNotebooks } from './positron/positronNotebooks';
import { PositronNewProjectWizard } from './positron/positronNewProjectWizard';
import { PositronExplorer } from './positron/positronExplorer';
import { PositronConnections } from './positron/positronConnections';
import { PositronHelp } from './positron/positronHelp';
import { PositronTopActionBar } from './positron/positronTopActionBar';
import { PositronLayouts } from './positron/positronLayouts';
import { PositronOutput } from './positron/positronOutput';
import { PositronWelcome } from './positron/positronWelcome';
import { PositronTerminal } from './positron/positronTerminal';
import { PositronViewer } from './positron/positronViewer';
import { PositronEditor } from './positron/positronEditor';
import { PositronTestExplorer } from './positron/positronTestExplorer';
import { PositronQuickInput } from './positron/positronQuickInput';
// --- End Positron ---

export interface Commands {
	runCommand(command: string, options?: { exactLabelMatch?: boolean }): Promise<any>;
}

export class Workbench {

	readonly quickaccess: QuickAccess;
	readonly quickinput: QuickInput;
	readonly editors: Editors;
	readonly explorer: Explorer;
	readonly activitybar: ActivityBar;
	readonly search: Search;
	readonly extensions: Extensions;
	readonly editor: Editor;
	readonly scm: SCM;
	readonly debug: Debug;
	readonly statusbar: StatusBar;
	readonly problems: Problems;
	readonly settingsEditor: SettingsEditor;
	readonly keybindingsEditor: KeybindingsEditor;
	readonly terminal: Terminal;
	readonly notebook: Notebook;
	readonly localization: Localization;
	readonly task: Task;

	// --- Start Positron ---
	readonly positronInterpreterDropdown: PositronInterpreterDropdown;
	readonly positronPopups: PositronPopups;
	readonly positronConsole: PositronConsole;
	readonly positronVariables: PositronVariables;
	readonly positronDataExplorer: PositronDataExplorer;
	readonly positronSideBar: PositronSideBar;
	readonly positronPlots: PositronPlots;
	readonly positronNotebooks: PositronNotebooks;
	readonly positronNewProjectWizard: PositronNewProjectWizard;
	readonly positronExplorer: PositronExplorer;
	readonly positronConnections: PositronConnections;
	readonly positronHelp: PositronHelp;
	readonly positronTopActionBar: PositronTopActionBar;
	readonly positronLayouts: PositronLayouts;
	readonly positronOutput: PositronOutput;
	readonly positronWelcome: PositronWelcome;
	readonly positronTerminal: PositronTerminal;
	readonly positronViewer: PositronViewer;
	readonly positronEditor: PositronEditor;
	readonly positronTestExplorer: PositronTestExplorer;
	readonly positronQuickInput: PositronQuickInput;
	// --- End Positron ---

	constructor(code: Code) {
		this.editors = new Editors(code);
		this.quickinput = new QuickInput(code);
		this.quickaccess = new QuickAccess(code, this.editors, this.quickinput);
		this.explorer = new Explorer(code);
		this.activitybar = new ActivityBar(code);
		this.search = new Search(code);
		this.extensions = new Extensions(code, this.quickaccess);
		this.editor = new Editor(code, this.quickaccess);
		this.scm = new SCM(code);
		this.debug = new Debug(code, this.quickaccess, this.editors, this.editor);
		this.statusbar = new StatusBar(code);
		this.problems = new Problems(code, this.quickaccess);
		this.settingsEditor = new SettingsEditor(code, this.editors, this.editor, this.quickaccess);
		this.keybindingsEditor = new KeybindingsEditor(code);
		this.terminal = new Terminal(code, this.quickaccess, this.quickinput);
		this.notebook = new Notebook(this.quickaccess, this.quickinput, code);
		this.localization = new Localization(code);
		this.task = new Task(code, this.editor, this.editors, this.quickaccess, this.quickinput, this.terminal);

		// --- Start Positron ---
		this.positronPopups = new PositronPopups(code);
		this.positronInterpreterDropdown = new PositronInterpreterDropdown(code);
		this.positronConsole = new PositronConsole(code, this.quickaccess, this.quickinput);
		this.positronVariables = new PositronVariables(code);
		this.positronDataExplorer = new PositronDataExplorer(code);
		this.positronSideBar = new PositronSideBar(code);
		this.positronPlots = new PositronPlots(code);
		this.positronNotebooks = new PositronNotebooks(code, this.quickinput, this.quickaccess, this.notebook);
		this.positronNewProjectWizard = new PositronNewProjectWizard(code, this.quickaccess);
		this.positronExplorer = new PositronExplorer(code);
		this.positronConnections = new PositronConnections(code, this.quickaccess);
		this.positronHelp = new PositronHelp(code);
		this.positronTopActionBar = new PositronTopActionBar(code);
		this.positronLayouts = new PositronLayouts(code, this);
		this.positronOutput = new PositronOutput(code, this.quickaccess, this.quickinput);
		this.positronWelcome = new PositronWelcome(code);
		this.positronTerminal = new PositronTerminal(code);
		this.positronViewer = new PositronViewer(code);
		this.positronEditor = new PositronEditor(code);
		this.positronTestExplorer = new PositronTestExplorer(code, this.positronExplorer);
		this.positronQuickInput = new PositronQuickInput(code);
		// --- End Positron ---
	}
}
