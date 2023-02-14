/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';

export const POSITRON_CONSOLE_VIEW_ID = 'workbench.panel.positronConsole';

export const enum PositronConsoleCommandId {
	New = 'workbench.action.positronConsole.new',
	Open = 'workbench.action.positronConsole.open',
	ClearConsole = 'workbench.action.positronConsole.clearConsole',
	ClearInputHistory = 'workbench.action.positronConsole.clearInputHistory',
	ExecuteCode = 'workbench.action.positronConsole.executeCode'
}

export const POSITRON_CONSOLE_ACTION_CATEGORY = nls.localize('positronConsoleCategory', "Console");
