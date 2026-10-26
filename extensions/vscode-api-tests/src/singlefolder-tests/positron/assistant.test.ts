/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import 'mocha';
import * as positron from 'positron';
import * as vscode from 'vscode';
import { assertNoRpcFromEntry } from '../../utils.js';
import assert from 'assert';

suite('positron API - ai', () => {

	suiteSetup(async () => {
		await vscode.extensions.getExtension('vscode.vscode-api-tests')?.activate();
	});

	teardown(async function () {
		assertNoRpcFromEntry([positron, 'positron']);
	});

	test('getCurrentPlotUri returns expected type', async () => {
		const plotUri = await positron.ai.getCurrentPlotUri();
		assert.ok(plotUri === undefined || typeof plotUri === 'string',
			'Plot URI should be either undefined or a string');
	});

});
