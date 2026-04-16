/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { createTestContainer } from './positronTestContainer.js';

describe('positronTestContainer', () => {

	describe('withReactServices', () => {
		const ctx = createTestContainer().withReactServices().build();

		it('creates a PositronReactServices instance without throwing', () => {
			// This test catches stale stub lists. If a new service is added
			// to PositronReactServices but not stubbed in withReactServices(),
			// createInstance() will throw "missing service" here.
			const services = ctx.reactServices;
			expect(services).toBeDefined();
		});
	});
});
