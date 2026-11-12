/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import { loadSettings } from '../skillGenerator';

/** A core setting the workbench registers, so the lookup runs against the real registry. */
const KNOWN_KEY = 'dataConnections.enabled';

suite('loadSettings', () => {
	test('keeps build-fixed facts for registered keys only, across batches, without the current value', async () => {
		// 100 unknown keys fill the first findSettings batch, so the known key is
		// only found if the lookup moves on to a second batch.
		const unknownKeys = Array.from({ length: 100 }, (_, index) => `positronSkills.test.unknown${index}`);
		// Move the setting off its default so findSettings reports a `value`; the
		// lookup must drop it, since the generated skill must not depend on it.
		const configuration = vscode.workspace.getConfiguration();
		await configuration.update(KNOWN_KEY, false, vscode.ConfigurationTarget.Global);
		try {
			const settings = await loadSettings([...unknownKeys, KNOWN_KEY]);
			// A JSON round-trip drops the fields the registry leaves undefined.
			assert.deepStrictEqual(JSON.parse(JSON.stringify([...settings.values()])), [
				{ key: KNOWN_KEY, type: 'boolean', default: true },
			]);
		} finally {
			await configuration.update(KNOWN_KEY, undefined, vscode.ConfigurationTarget.Global);
		}
	});
});
