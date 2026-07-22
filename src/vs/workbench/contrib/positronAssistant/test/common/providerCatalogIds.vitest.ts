/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { SETTING_NAME_TO_CATALOG_ID, catalogIdForSettingName } from '../../common/providerCatalogIds.js';

describe('providerCatalogIds', () => {
	it('maps every #14928 migration pair', () => {
		expect(Object.fromEntries(SETTING_NAME_TO_CATALOG_ID)).toEqual({
			anthropic: 'anthropic',
			positAI: 'positai',
			amazonBedrock: 'bedrock',
			msFoundry: 'ms-foundry',
			snowflakeCortex: 'snowflake-cortex',
			openAI: 'openai',
			google: 'gemini',
			googleVertex: 'google-vertex',
			githubCopilot: 'copilot',
			customProvider: 'openai-compatible',
			deepseek: 'deepseek',
		});
	});
	it('returns undefined for unmapped dev providers', () => {
		expect(catalogIdForSettingName('echo')).toBeUndefined();
		expect(catalogIdForSettingName('error')).toBeUndefined();
	});
});
