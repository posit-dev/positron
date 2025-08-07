/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';

/* Commands contributed by this extension. */
export enum Command {
	DebugCell = 'notebook.debugCell',
}

/* The descriptor used in each runtime's debugger output channel. */
export const DEBUGGER_OUTPUT_CHANNEL_DESCRIPTOR = vscode.l10n.t('Debugger');
