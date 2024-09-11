/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export interface RunAppOptions {
	label: string;
	languageId: string;
	urlPath?: string;
	getRunCommand(runtimePath: string, document: vscode.TextDocument): string | undefined | Promise<string | undefined>;
}

export interface PositronRunAppApi {
	runApplication(options: RunAppOptions): Promise<void>;
}
