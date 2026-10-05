/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Emitter } from '../../../../../base/common/event.js';
import { PositronAssistantConfigurationService } from '../../browser/positronAssistantService.js';
import { IAiProviderService } from '../../../../services/positronAiProvider/common/aiProviderService.js';
import { IProviderCatalogChangeData } from '../../../../../platform/positronAiProvider/common/aiProviderCatalog.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';

describe('PositronAssistantConfigurationService', () => {
	const catalogEnabled = new Map<string, boolean>();
	const onDidChangeProvidersEmitter = new Emitter<IProviderCatalogChangeData>();
	const ctx = createTestContainer()
		.stub(IAiProviderService, {
			// The catalog "knows" exactly the ids in catalogEnabled.
			getProvider: (id: string) => catalogEnabled.has(id)
				? { id, enabled: catalogEnabled.get(id) === true, connection: {} }
				: undefined,
			isEnabled: (id: string) => catalogEnabled.get(id) === true,
			onDidChangeProviders: onDidChangeProvidersEmitter.event,
			whenInitialized: Promise.resolve(),
		})
		.build();

	let service: PositronAssistantConfigurationService;

	beforeEach(() => {
		catalogEnabled.clear();
		service = ctx.disposables.add(ctx.instantiationService.createInstance(PositronAssistantConfigurationService));
	});

	describe('catalog-driven enablement', () => {
		function catalogChangeData(overrides: Partial<IProviderCatalogChangeData> = {}): IProviderCatalogChangeData {
			return {
				catalog: [],
				enabledChanged: false,
				connectionChanged: false,
				modelsChanged: false,
				...overrides,
			};
		}

		it('reports the catalog verdict for a provider the catalog knows', () => {
			catalogEnabled.set('openai', true);
			catalogEnabled.set('anthropic', false);

			expect([
				service.isProviderEnabled('openai'),
				service.isProviderEnabled('anthropic'),
			]).toEqual([true, false]);
		});

		it('leaves a provider the catalog has never heard of enabled', () => {
			// A chat vendor with no providers.json entry must not be silently
			// filtered out of the model picker.
			expect(service.isProviderEnabled('some-third-party-vendor')).toBe(true);
		});

		it('follows a later catalog flip', () => {
			catalogEnabled.set('openai', true);
			expect(service.isProviderEnabled('openai')).toBe(true);

			catalogEnabled.set('openai', false);
			expect(service.isProviderEnabled('openai')).toBe(false);
		});

		it('onChangeEnabledProviders fires on a catalog enabledChanged event', () => {
			const fired = vi.fn();
			ctx.disposables.add(service.onChangeEnabledProviders(fired));

			onDidChangeProvidersEmitter.fire(catalogChangeData({ enabledChanged: true }));
			onDidChangeProvidersEmitter.fire(catalogChangeData({ connectionChanged: true }));

			expect(fired).toHaveBeenCalledTimes(1);
		});
	});

	describe('copilotEnabled', () => {
		it('fires onChangeCopilotEnabled when set', () => {
			const fired = vi.fn();
			ctx.disposables.add(service.onChangeCopilotEnabled(fired));

			service.copilotEnabled = true;

			expect([service.copilotEnabled, fired.mock.calls]).toEqual([true, [[true]]]);
		});
	});
});
