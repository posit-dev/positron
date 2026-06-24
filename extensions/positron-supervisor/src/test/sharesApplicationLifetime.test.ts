/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import { sharesApplicationLifetime } from '../KallichoreAdapterApi';

suite('sharesApplicationLifetime', () => {
	test('desktop with immediate shutdown shares the application lifetime', () => {
		assert.strictEqual(
			sharesApplicationLifetime(vscode.UIKind.Desktop, 'immediately'),
			true,
		);
	});

	test('desktop with a detached shutdown timeout outlives the application', () => {
		// Any non-default timeout (hours, 'when idle', 'indefinitely') runs the
		// server detached so it can be reconnected to on the next launch.
		for (const timeout of ['when idle', '1', '2', 'indefinitely']) {
			assert.strictEqual(
				sharesApplicationLifetime(vscode.UIKind.Desktop, timeout),
				false,
				`expected '${timeout}' to outlive the application`,
			);
		}
	});

	test('web servers outlive the application regardless of shutdown timeout', () => {
		assert.strictEqual(
			sharesApplicationLifetime(vscode.UIKind.Web, 'immediately'),
			false,
		);
	});
});
