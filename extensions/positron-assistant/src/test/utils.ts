/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from 'sinon';
import { PROVIDER_METADATA } from '../providerMetadata.js';
import * as providersModule from '../providers';

export function mock<T>(obj: Partial<T>): T {
	return obj as T;
}

/**
 * Shared test provider definitions for use across test files.
 * Each provider has the minimal structure needed for mocking getModelProviders().
 * Automatically derived from PROVIDER_METADATA.
 */
export const TEST_PROVIDERS = Object.values(PROVIDER_METADATA).map(provider => ({
	source: { provider }
}));

/**
 * Stubs getModelProviders() to return TEST_PROVIDERS.
 * Call this in your test setup() and sinon.restore() in teardown().
 */
export function stubGetModelProviders(): sinon.SinonStub {
	// eslint-disable-next-line local/code-no-any-casts
	return sinon.stub(providersModule, 'getModelProviders').returns(TEST_PROVIDERS as any);
}
