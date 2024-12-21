/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

import { LOGGER } from './extension';
import { RSessionManager } from './session-manager';
import { EnvVar, RSession } from './session';

export async function registerUriHandler() {
	vscode.window.registerUriHandler({ handleUri });
}

// Temporary feature flag to finesse the fact that cli hyperlinks are either all ON or all OFF.
// cli 3.6.3.9001 gained support for configuring the URL format of run/help/vignette hyperlinks.
// But file hyperlinks are not yet configurable and will delegate to operating system.
// If the user still has RStudio as the app associated with .R files, it will open in RStudio.
// Flag will be removed once cli can be configured to emit positron://file/... hyperlinks.
function taskHyperlinksEnabled(): boolean {
	const extConfig = vscode.workspace.getConfiguration('positron.r');
	const taskHyperlinksEnabled = extConfig.get<boolean>('taskHyperlinks');

	return taskHyperlinksEnabled === true;
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
function handleUri(uri: vscode.Uri): void {
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

	const session = RSessionManager.instance.getConsoleSession();
	if (!session) {
		return;
	}

	session.openResource(command);
	vscode.commands.executeCommand('workbench.panel.positronConsole.focus');
}

export async function prepCliEnvVars(session?: RSession): Promise<EnvVar> {
	session = session || RSessionManager.instance.getConsoleSession();
	if (!session) {
		return {};
	}

	const taskHyperlinks = taskHyperlinksEnabled();
	const cliPkg = await session.packageVersion('cli', '3.6.3.9002');
	const cliSupportsHyperlinks = cliPkg?.compatible ?? false;

	if (!taskHyperlinks || !cliSupportsHyperlinks) {
		// eslint-disable-next-line @typescript-eslint/naming-convention
		return { R_CLI_HYPERLINKS: 'FALSE' };
	}

	return {
		/* eslint-disable @typescript-eslint/naming-convention */
		R_CLI_HYPERLINKS: 'TRUE',
		R_CLI_HYPERLINK_FILE_URL_FORMAT: 'positron://file{path}:{line}:{column}',
		// TODO: I'd like to request POSIX compliant hyperlinks in the future, but currently
		// cli's tests implicitly assume the default and there are more important changes to
		// propose in cli, such as tweaks to file hyperlinks. Leave this alone for now.
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
