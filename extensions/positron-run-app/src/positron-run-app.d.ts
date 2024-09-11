/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export interface RunAppCommand {
	command: string;
	env?: { [key: string]: string | null | undefined };
	path?: string;
}

export interface RunAppOptions {
	label: string;
	languageId: string;
	getRunCommand(runtimePath: string, document: vscode.TextDocument): Promise<RunAppCommand | undefined>;
}

export interface PositronRunAppApi {
	runApplication(options: RunAppOptions): Promise<void>;
}
