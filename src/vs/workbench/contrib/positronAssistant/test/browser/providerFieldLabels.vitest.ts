/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { getBaseUrlLabel } from '../../browser/providerFieldLabels.js';

describe('getBaseUrlLabel', () => {
	it('labels the Databricks base URL as the workspace URL', () => {
		expect(getBaseUrlLabel('databricks')).toBe('Workspace URL');
	});

	it('labels other providers with the generic base URL label', () => {
		expect(getBaseUrlLabel('anthropic-api')).toBe('Base URL');
	});
});
