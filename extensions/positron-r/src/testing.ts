/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export function discoverTests(context: vscode.ExtensionContext) {
	const controller = vscode.tests.createTestController(
		'rPackageTests',
		'R Package Tests'
	);



}
