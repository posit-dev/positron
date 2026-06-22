/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { getAiModelsKeyForProvider, getSettingNameForProvider } from '../providerMetadata.js';

suite('Provider Metadata', () => {
	suite('getAiModelsKeyForProvider', () => {
		test('google maps to gemini (aiModelsKey override)', () => {
			assert.strictEqual(getAiModelsKeyForProvider('google'), 'gemini');
		});

		test('anthropic-api falls back to settingName when no aiModelsKey', () => {
			assert.strictEqual(getAiModelsKeyForProvider('anthropic-api'), 'anthropic');
		});

		test('returns undefined for unknown provider', () => {
			assert.strictEqual(getAiModelsKeyForProvider('unknown-provider'), undefined);
		});
	});

	suite('getSettingNameForProvider', () => {
		test('openai-api maps to openAI', () => {
			assert.strictEqual(getSettingNameForProvider('openai-api'), 'openAI');
		});

		test('returns undefined for unknown provider', () => {
			assert.strictEqual(getSettingNameForProvider('unknown-provider'), undefined);
		});
	});
});
