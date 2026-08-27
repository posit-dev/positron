/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { isSageMakerSession, markSageMakerSession, sageMakerMarkerScript } from '../../common/positronSageMakerSession.js';

describe('positronSageMakerSession', () => {
	describe('sageMakerMarkerScript', () => {
		it('emits the marker script for a SageMaker session', () => {
			expect(sageMakerMarkerScript(true)).toBe('<script>globalThis._POSITRON_IS_SAGEMAKER = true;</script>');
		});

		it('emits nothing for a session that is not SageMaker', () => {
			expect(sageMakerMarkerScript(false)).toBe('');
		});
	});

	// Vitest runs with a Node `process`, so `platform.isWeb` is false here and this covers the
	// server side. Marking is one-way, so the transition is asserted in a single test.
	it('reports SageMaker only once the license manager has confirmed the lease', () => {
		expect(isSageMakerSession()).toBe(false);
		markSageMakerSession();
		expect(isSageMakerSession()).toBe(true);
	});
});
