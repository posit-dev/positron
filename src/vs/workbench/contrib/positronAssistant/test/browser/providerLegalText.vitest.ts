/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { getProviderGettingStartedText, getProviderTermsOfServiceText, getProviderUsageDisclaimerText } from '../../browser/providerLegalText.js';

const positAi = { id: 'posit-ai', displayName: 'Posit AI', settingName: 'posit-ai' };

describe('providerLegalText', () => {
	it('builds a getting-started note for Posit AI', () => {
		expect(getProviderGettingStartedText(positAi)).toContain('Posit AI');
	});

	it('builds Posit AI terms-of-service text referencing the EULA', () => {
		expect(getProviderTermsOfServiceText(positAi)).toContain('EULA');
	});

	it('builds a usage disclaimer naming the provider', () => {
		expect(getProviderUsageDisclaimerText(positAi)).toContain('Posit AI');
	});
});
