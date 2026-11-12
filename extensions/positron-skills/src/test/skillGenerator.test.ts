/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import { loadSettings } from '../skillGenerator';

/**
 * A stable core setting with a numeric range, so the lookup runs against the
 * real registry and carries `minimum` and `maximum` through. Changing it has no
 * side effects in the test host.
 */
const KNOWN_KEY = 'editor.tabSize';

suite('loadSettings', () => {
	test('keeps build-fixed facts for registered keys only, past the per-call cap, without the current value', async () => {
		// findSettings answers at most 100 explicit keys per call, so the known
		// key, placed after 100 unknown ones, is only found if the lookup asks
		// again for the keys the first call didn't reach.
		const unknownKeys = Array.from({ length: 100 }, (_, index) => `positronSkills.test.unknown${index}`);
		// Move the setting off its default so findSettings reports a `value`; the
		// lookup must drop it, since the generated skill must not depend on it.
		const configuration = vscode.workspace.getConfiguration();
		await configuration.update(KNOWN_KEY, 2, vscode.ConfigurationTarget.Global);
		try {
			const settings = await loadSettings([...unknownKeys, KNOWN_KEY]);
			// A JSON round-trip drops the fields the registry leaves undefined.
			assert.deepStrictEqual(JSON.parse(JSON.stringify([...settings.values()])), [
				{ key: KNOWN_KEY, type: 'number', default: 4, minimum: 1, maximum: 100 },
			]);
		} finally {
			await configuration.update(KNOWN_KEY, undefined, vscode.ConfigurationTarget.Global);
		}
	});
});
