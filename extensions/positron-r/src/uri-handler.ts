/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import { RSessionManager } from './session-manager';
import { EnvVar, RSession } from './session';

export async function registerUriHandler() {
	vscode.window.registerUriHandler({ handleUri });
}

// Example of a URI we expect to handle:
// positron://positron.positron-r/cli?command=x-r-run:testthat::snapshot_review('snap')
//
// How the example URI breaks down:
// {
//    "scheme": "positron",
//    "authority": "positron.positron-r",
//    "path": "/cli",
//    "query": "command=x-r-run:testthat::snapshot_review('zzz')",
//    "fragment": "",
//    "fsPath": "/cli"
// }
async function handleUri(uri: vscode.Uri): Promise<void> {
	if (uri.path !== '/cli') {
		return;
	}

	// Turns this query string
	// "command=x-r-run:testthat::snapshot_review('zzz')"
	// into this object
	// { "command": "x-r-run:testthat::snapshot_review('zzz')" }
	const query = new URLSearchParams(uri.query);
	const command = query.get('command');
	if (!command) {
		return;
	}

	const commandRegex = /^(x-r-(help|run|vignette)):(.+)$/;
	if (!commandRegex.test(command)) {
		return;
	}

	const session = await RSessionManager.instance.getConsoleSession();
	if (!session) {
		return;
	}

	session.openResource(command);
	vscode.commands.executeCommand('workbench.panel.positronConsole.focus');
}

export async function prepCliEnvVars(session?: RSession): Promise<EnvVar> {
	session = session || await RSessionManager.instance.getConsoleSession();
	if (!session) {
		return {};
	}

	const cliPkg = await session.packageVersion('cli', '3.6.3.9002');
	const cliSupportsHyperlinks = cliPkg?.compatible ?? false;

	if (!cliSupportsHyperlinks) {
		// eslint-disable-next-line @typescript-eslint/naming-convention
		return { R_CLI_HYPERLINKS: 'FALSE' };
	}

	return {
		/* eslint-disable @typescript-eslint/naming-convention */
		R_CLI_HYPERLINKS: 'TRUE',
		R_CLI_HYPERLINK_FILE_URL_FORMAT: 'positron://file{path}:{line}:{column}',
		// TODO: I'd like to request POSIX compliant hyperlinks in the future, but currently
		// cli's tests implicitly assume the default. Doesn't seem worth the fuss at this time.
		// R_CLI_HYPERLINK_MODE: "posix",
		R_CLI_HYPERLINK_RUN: 'TRUE',
		R_CLI_HYPERLINK_RUN_URL_FORMAT: 'positron://positron.positron-r/cli?command=x-r-run:{code}',
		R_CLI_HYPERLINK_HELP: 'TRUE',
		R_CLI_HYPERLINK_HELP_URL_FORMAT: 'positron://positron.positron-r/cli?command=x-r-help:{topic}',
		R_CLI_HYPERLINK_VIGNETTE: 'TRUE',
		R_CLI_HYPERLINK_VIGNETTE_URL_FORMAT: 'positron://positron.positron-r/cli?command=x-r-vignette:{vignette}'
		/* eslint-enable @typescript-eslint/naming-convention */
	};
}
