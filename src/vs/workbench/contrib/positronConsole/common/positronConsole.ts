/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';

export const POSITRON_CONSOLE_VIEW_ID = 'workbench.panel.positronConsole';

export const enum PositronConsoleCommandId {
	New = 'workbench.action.positronConsole.new',
	Open = 'workbench.action.positronConsole.open',
	Clear = 'workbench.action.positronConsole.clear',
	Send = 'workbench.action.positronConsole.send'
}

export const POSITRON_CONSOLE_ACTION_CATEGORY = nls.localize('positronConsoleCategory', "Console");
