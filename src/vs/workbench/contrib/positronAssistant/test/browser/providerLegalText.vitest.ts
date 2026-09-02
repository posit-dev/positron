/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { getProviderGettingStartedText, getProviderTermsOfServiceText, getProviderUsageDisclaimerText } from '../../browser/providerLegalText.js';

const positAi = { id: 'posit-ai', displayName: 'Posit AI Pass', settingName: 'posit-ai' };
const custom = { id: 'openai-compatible', displayName: 'OpenAI Compatible', settingName: 'openai-compatible' };
const customAnthropic = { id: 'my anthropic', displayName: 'my anthropic', customKind: 'anthropic' };

describe('providerLegalText', () => {
	it('builds a getting-started note for Posit AI Pass', () => {
		expect(getProviderGettingStartedText(positAi)).toContain('Posit AI Pass');
	});

	it('points the custom provider terms at the chosen endpoint provider, not Posit', () => {
		const text = getProviderTermsOfServiceText(custom);
		expect(text).toContain('depend entirely on the provider you choose');
		expect(text).not.toContain('EULA');
	});

	it('builds Posit AI Pass terms-of-service text referencing the EULA', () => {
		expect(getProviderTermsOfServiceText(positAi)).toContain('EULA');
	});

	it('builds a usage disclaimer naming the provider', () => {
		expect(getProviderUsageDisclaimerText(positAi)).toContain('Posit AI Pass');
	});

	it('gives a custom entry the custom text rather than treating its name as a vendor', () => {
		expect(getProviderTermsOfServiceText(customAnthropic)).toBe(getProviderTermsOfServiceText(custom));
		expect(getProviderUsageDisclaimerText(customAnthropic)).toBe(getProviderUsageDisclaimerText(custom));
		expect(getProviderUsageDisclaimerText(customAnthropic)).not.toContain('my anthropic');
	});
});
