/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { ILanguageRuntimeService } from '../../workbench/services/languageRuntime/common/languageRuntimeService.js';
import { IRuntimeSessionService } from '../../workbench/services/runtimeSession/common/runtimeSessionService.js';
import { createLightTestContainer } from './lightTestContainer.js';

describe('lightTestContainer', () => {

	describe('bare', () => {
		const ctx = createLightTestContainer()
			.stub(ILanguageRuntimeService, { registeredRuntimes: [] })
			.build();

		it('registers only user stubs', () => {
			expect(ctx.get(ILanguageRuntimeService).registeredRuntimes).toEqual([]);
			expect(ctx.get(IRuntimeSessionService)).toBeUndefined();
		});
	});

	describe('withRuntimeServices', () => {
		const ctx = createLightTestContainer().withRuntimeServices().build();

		it('wires the runtime services', () => {
			expect(ctx.get(ILanguageRuntimeService).registeredRuntimes).toEqual([]);
		});
	});
});
