/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as testKit from './kit';

export let currentTestName: string | undefined;

suiteSetup(async () => {
	// Set global Positron log level to debug on CI for easier debugging
	if (process.env.CI) {
		await vscode.commands.executeCommand('_extensionTests.setLogLevel', 'debug');
	}

	// Set Ark kernel process log level to trace
	await vscode.workspace.getConfiguration().update('positron.r.kernel.logLevel', 'trace', vscode.ConfigurationTarget.Global);

	// To be safe
	await testKit.closeAllEditors();
});

setup(function () {
	currentTestName = this.currentTest.title;
});

teardown(function () {
	currentTestName = undefined;
});
