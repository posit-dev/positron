/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

// eslint-disable-next-line import/no-unresolved
import * as positron from 'positron';

export interface RunAppCommand {
    command: string;
    env?: { [key: string]: string | null | undefined };
    url?: string;
}

export interface RunAppOptions {
    label: string;
    languageId: string;
    getRunCommand(
        runtimePath: string,
        document: vscode.TextDocument,
        port: number,
    ): RunAppCommand | undefined | Promise<RunAppCommand | undefined>;
}

export interface PositronRunAppApi {
    runApplication(options: RunAppOptions): Promise<void>;
}
