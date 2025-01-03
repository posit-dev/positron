/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// --- Start Positron ---
// Removed existing imports
// --- End Positron ---
import { Code } from './code';
// --- Start Positron ---
// Removed existing imports
// --- End Positron ---

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
import { PositronEditors } from './positron/positronEditors';
import { PositronTestExplorer } from './positron/positronTestExplorer';
import { PositronQuickAccess } from './positron/positronQuickaccess';
import { PositronOutline } from './positron/positronOutline';
import { PositronClipboard } from './positron/positronClipboard';
import { PositronQuickInput } from './positron/positronQuickInput';
import { PositronExtensions } from './positron/positronExtensions';
import { PositronSettings } from './positron/positronSettings';
// --- End Positron ---

export interface Commands {
	runCommand(command: string, options?: { exactLabelMatch?: boolean }): Promise<any>;
}

export class Workbench {

	// --- Start Positron ---

	// removed existing properties

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
	readonly positronQuickaccess: PositronQuickAccess;
	readonly positronOutline: PositronOutline;
	readonly positronClipboard: PositronClipboard;
	readonly positronQuickInput: PositronQuickInput;
	readonly positronExtensions: PositronExtensions;
	readonly positronEditors: PositronEditors;
	readonly positronSettings: PositronSettings;
	// --- End Positron ---

	constructor(code: Code) {
		// --- Start Positron ---

		// removed existing initializations

		this.positronPopups = new PositronPopups(code);
		this.positronInterpreterDropdown = new PositronInterpreterDropdown(code);
		this.positronVariables = new PositronVariables(code);
		this.positronDataExplorer = new PositronDataExplorer(code, this);
		this.positronSideBar = new PositronSideBar(code);
		this.positronPlots = new PositronPlots(code);
		this.positronExplorer = new PositronExplorer(code);
		this.positronHelp = new PositronHelp(code);
		this.positronTopActionBar = new PositronTopActionBar(code);
		this.positronLayouts = new PositronLayouts(code, this);
		this.positronQuickInput = new PositronQuickInput(code);
		this.positronEditors = new PositronEditors(code);
		this.positronQuickaccess = new PositronQuickAccess(code, this.positronEditors, this.positronQuickInput);
		this.positronConnections = new PositronConnections(code, this.positronQuickaccess);
		this.positronNewProjectWizard = new PositronNewProjectWizard(code, this.positronQuickaccess);
		this.positronOutput = new PositronOutput(code, this.positronQuickaccess, this.positronQuickInput);
		this.positronConsole = new PositronConsole(code, this.positronQuickaccess, this.positronQuickInput);
		this.positronNotebooks = new PositronNotebooks(code, this.positronQuickInput, this.positronQuickaccess);
		this.positronWelcome = new PositronWelcome(code);
		this.positronTerminal = new PositronTerminal(code, this.positronQuickaccess);
		this.positronViewer = new PositronViewer(code);
		this.positronEditor = new PositronEditor(code);
		this.positronTestExplorer = new PositronTestExplorer(code);
		this.positronOutline = new PositronOutline(code, this.positronQuickaccess);
		this.positronClipboard = new PositronClipboard(code);
		this.positronExtensions = new PositronExtensions(code, this.positronQuickaccess);
		this.positronSettings = new PositronSettings(code, this.positronEditors, this.positronEditor, this.positronQuickaccess);
		// --- End Positron ---
	}
}
