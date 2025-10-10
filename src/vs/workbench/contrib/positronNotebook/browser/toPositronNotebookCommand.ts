/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import { EXECUTE_CELL_COMMAND_ID } from '../../notebook/browser/notebookBrowser.js';
import { POSITRON_EXECUTE_CELL_COMMAND_ID } from '../common/positronNotebookCommon.js';


const _code2PositronCommandId: Record<string, string> = {
	[EXECUTE_CELL_COMMAND_ID]: POSITRON_EXECUTE_CELL_COMMAND_ID,
};

export function toPositronNotebookCommand(commandId: string): string | undefined {
	try {
		return _code2PositronCommandId[commandId];
	} catch {
		return undefined;
	}
}
