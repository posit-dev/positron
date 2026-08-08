/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import { isQuartoInlineOutputEnabled } from '../quarto';

const CANONICAL_KEY = 'quarto.inlineOutput.enabled';
const DEPRECATED_KEY = 'positron.quarto.inlineOutput.enabled';

/**
 * Set a user setting, or clear it when the value is undefined.
 */
async function setUserValue(key: string, value: boolean | undefined): Promise<void> {
	await vscode.workspace.getConfiguration().update(key, value, vscode.ConfigurationTarget.Global);
}

// Reads the real workspace configuration, so that the fallback is checked
// against the settings machinery rather than against a stand-in for it.
suite('isQuartoInlineOutputEnabled', () => {
	teardown(async () => {
		await setUserValue(CANONICAL_KEY, undefined);
		await setUserValue(DEPRECATED_KEY, undefined);
	});

	test('follows the canonical key when only the canonical key is set', async () => {
		await setUserValue(CANONICAL_KEY, true);

		assert.strictEqual(isQuartoInlineOutputEnabled(), true);
	});

	test('falls back to the deprecated key when the canonical key is unset', async () => {
		await setUserValue(DEPRECATED_KEY, true);

		assert.strictEqual(isQuartoInlineOutputEnabled(), true);
	});

	test('an explicit false on the canonical key wins over the deprecated key', async () => {
		await setUserValue(CANONICAL_KEY, false);
		await setUserValue(DEPRECATED_KEY, true);

		assert.strictEqual(isQuartoInlineOutputEnabled(), false);
	});
});
