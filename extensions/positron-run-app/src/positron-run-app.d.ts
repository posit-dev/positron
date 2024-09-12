/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';
import * as vscode from 'vscode';

export interface RunAppTerminalOptions {
	commandLine: string;
	env?: { [key: string]: string | null | undefined };
}

export interface RunAppOptions {
	label: string;
	getTerminalOptions: (runtime: positron.LanguageRuntimeMetadata, document: vscode.TextDocument, port?: string, urlPrefix?: string) => RunAppTerminalOptions | undefined | Promise<RunAppTerminalOptions | undefined>;
	urlPath?: string;
}

export interface PositronRunAppApi {
	runApplication(options: RunAppOptions): Promise<void>;
}
