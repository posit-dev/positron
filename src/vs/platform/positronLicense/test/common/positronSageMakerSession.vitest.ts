/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { sageMakerMarkerScript } from '../../common/positronSageMakerSession.js';

const PLATFORM_MODULE = '../../../../base/common/platform.js';
type PlatformModule = typeof import('../../../../base/common/platform.js');

/**
 * Loads a fresh copy of the module, optionally as the browser build. Marking is one-way module
 * state and `isWeb` is read at import time, so neither can be varied without re-importing.
 */
async function loadSession(options: { web?: boolean } = {}) {
	vi.resetModules();
	vi.doUnmock(PLATFORM_MODULE);
	if (options.web) {
		// Spread the real module so only `isWeb` changes; a bare object would turn every other
		// export into `undefined`.
		vi.doMock(PLATFORM_MODULE, async importOriginal => ({
			...await importOriginal<PlatformModule>(),
			isWeb: true,
		}));
	}
	return import('../../common/positronSageMakerSession.js');
}

describe('positronSageMakerSession', () => {
	describe('sageMakerMarkerScript', () => {
		it('emits the marker script for a SageMaker session', () => {
			expect(sageMakerMarkerScript(true)).toBe('<script>globalThis._POSITRON_IS_SAGEMAKER = true;</script>');
		});

		it('emits nothing for a session that is not SageMaker', () => {
			expect(sageMakerMarkerScript(false)).toBe('');
		});
	});

	// Marking is one-way, so the transition is asserted in a single test.
	it('reports SageMaker on the server only once the license manager has confirmed the lease', async () => {
		const { isSageMakerSession, markSageMakerSession } = await loadSession();

		expect(isSageMakerSession()).toBe(false);
		markSageMakerSession();
		expect(isSageMakerSession()).toBe(true);
	});

	// The browser never runs the license check; it only sees the global that the marker script
	// injected, so the two halves have to agree on the name.
	it('reports SageMaker in the browser from the injected marker global', async () => {
		const { isSageMakerSession, markSageMakerSession, POSITRON_IS_SAGEMAKER_GLOBAL } = await loadSession({ web: true });
		const globals = globalThis as Record<string, unknown>;

		try {
			expect(isSageMakerSession()).toBe(false);
			// Server-side marking must not leak into the browser's answer.
			markSageMakerSession();
			expect(isSageMakerSession()).toBe(false);

			globals[POSITRON_IS_SAGEMAKER_GLOBAL] = true;
			expect(isSageMakerSession()).toBe(true);
		} finally {
			delete globals[POSITRON_IS_SAGEMAKER_GLOBAL];
		}
	});
});
