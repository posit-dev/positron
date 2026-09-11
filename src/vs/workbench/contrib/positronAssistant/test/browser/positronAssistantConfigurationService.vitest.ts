/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Emitter } from '../../../../../base/common/event.js';
import { PositronAssistantConfigurationService } from '../../browser/positronAssistantService.js';
import { IPositronLanguageModelSource, PositronLanguageModelType } from '../../common/interfaces/positronAssistantService.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { INotificationService, IPromptChoice } from '../../../../../platform/notification/common/notification.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IAiProviderService } from '../../../../services/positronAiProvider/common/aiProviderService.js';
import { IProviderCatalogChangeData } from '../../../../../platform/positronAiProvider/common/aiProviderCatalog.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';

function makeSource(id: string, catalogId?: string): IPositronLanguageModelSource {
	return {
		type: PositronLanguageModelType.Chat,
		provider: { id, displayName: `Display ${id}`, catalogId },
		supportedOptions: [],
		defaults: {},
	};
}

describe('PositronAssistantConfigurationService', () => {
	const configurationService = new TestConfigurationService();
	const prompt = vi.fn();
	const executeCommand = vi.fn();
	const catalogEnabled = new Map<string, boolean>();
	const onDidChangeProvidersEmitter = new Emitter<IProviderCatalogChangeData>();
	const ctx = createTestContainer()
		.stub(IConfigurationService, configurationService)
		.stub(INotificationService, { prompt })
		.stub(ICommandService, { executeCommand })
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

	function registerProvider(id: string, enabled = true, catalogId: string = id) {
		catalogEnabled.set(catalogId, enabled);
		service.registerProvider(makeSource(id, catalogId));
	}

	function registeredSource(id: string): IPositronLanguageModelSource {
		const source = service.getRegisteredSources().find(s => s.provider.id === id);
		expect(source).toBeDefined();
		return source!;
	}

	describe('updateProvider status notifications', () => {
		it('notifies once with the status message on transition to error', () => {
			registerProvider('prov-a');
			service.updateProvider('prov-a', { signedIn: false, status: 'error', statusMessage: 'Authentication expired' });

			expect(prompt).toHaveBeenCalledTimes(1);
			expect(prompt.mock.calls[0][1]).toBe('Display prov-a: Authentication expired');

			// The Configure action opens the config dialog at this provider.
			const choices = prompt.mock.calls[0][2] as IPromptChoice[];
			choices[0].run();
			expect(executeCommand).toHaveBeenCalledWith('authentication.configureProviders', { preselectedProviderId: 'prov-a' });
		});

		it('stays silent for ok and null statuses', () => {
			registerProvider('prov-a');
			service.updateProvider('prov-a', { signedIn: true, status: 'ok' });
			service.updateProvider('prov-a', { signedIn: false, status: null });

			expect(prompt).not.toHaveBeenCalled();
		});

		it('stays silent for disabled providers', () => {
			// 'anthropic' is in the catalog with enabled=false, so the provider is
			// disabled and the error status stays quiet.
			registerProvider('anthropic', false);
			service.updateProvider('anthropic', { status: 'error', statusMessage: 'Authentication expired' });

			expect(prompt).not.toHaveBeenCalled();
		});

		it('does not re-notify on repeated error updates', () => {
			registerProvider('prov-a');
			service.updateProvider('prov-a', { status: 'error', statusMessage: 'Authentication expired' });
			service.updateProvider('prov-a', { status: 'error', statusMessage: 'Still expired' });

			expect(prompt).toHaveBeenCalledTimes(1);
		});

		it('re-arms the notification after an ok status', () => {
			registerProvider('prov-a');
			service.updateProvider('prov-a', { status: 'error', statusMessage: 'Authentication expired' });
			service.updateProvider('prov-a', { status: 'ok' });
			service.updateProvider('prov-a', { status: 'error', statusMessage: 'Authentication expired' });

			expect(prompt).toHaveBeenCalledTimes(2);
		});

		it('re-arms the notification after a signedIn update', () => {
			registerProvider('prov-a');
			service.updateProvider('prov-a', { status: 'error', statusMessage: 'Authentication expired' });
			service.updateProvider('prov-a', { signedIn: true });
			service.updateProvider('prov-a', { status: 'error', statusMessage: 'Authentication expired' });

			expect(prompt).toHaveBeenCalledTimes(2);
		});

		it('falls back to a generic message without statusMessage', () => {
			registerProvider('prov-a');
			service.updateProvider('prov-a', { status: 'error' });

			expect(prompt).toHaveBeenCalledTimes(1);
			expect(prompt.mock.calls[0][1]).toContain('Display prov-a');
		});

		it('is a no-op for unknown providers', () => {
			service.updateProvider('prov-unknown', { status: 'error', statusMessage: 'Authentication expired' });

			expect(prompt).not.toHaveBeenCalled();
		});
	});

	describe('updateProvider status state', () => {
		it('stores an explicit null status', () => {
			registerProvider('prov-a');
			service.updateProvider('prov-a', { status: 'error', statusMessage: 'Authentication expired' });
			service.updateProvider('prov-a', { status: null });

			expect(registeredSource('prov-a')).toMatchObject({ status: null, statusMessage: undefined });
		});

		it('clears statusMessage on non-error statuses', () => {
			registerProvider('prov-a');
			service.updateProvider('prov-a', { status: 'error', statusMessage: 'Authentication expired' });
			service.updateProvider('prov-a', { status: 'ok' });

			expect(registeredSource('prov-a')).toMatchObject({ status: 'ok', statusMessage: undefined });
		});

		it('resets status to ok on a fresh sign-in', () => {
			registerProvider('prov-a');
			service.updateProvider('prov-a', { signedIn: false, status: 'error', statusMessage: 'Authentication expired' });
			service.updateProvider('prov-a', { signedIn: true });

			expect(registeredSource('prov-a')).toMatchObject({ signedIn: true, status: 'ok', statusMessage: undefined });
		});

		it('leaves status untouched when the update omits it', () => {
			registerProvider('prov-a');
			service.updateProvider('prov-a', { status: 'error', statusMessage: 'Authentication expired' });
			service.updateProvider('prov-a', { authMethods: ['oauth'] });

			expect(registeredSource('prov-a')).toMatchObject({ status: 'error', statusMessage: 'Authentication expired' });
		});
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

		it('getEnabledProviders returns registered ids whose catalog id is enabled', () => {
			registerProvider('openAI', true, 'openai');

			expect(service.getEnabledProviders()).toEqual(['openAI']);

			catalogEnabled.set('openai', false);

			expect(service.getEnabledProviders()).toEqual([]);
		});

		it('isProviderEnabled resolves the registered id and its catalog id to the same source', () => {
			service.registerProvider(makeSource('openai-api', 'openai'));
			catalogEnabled.set('openai', true);

			expect(service.isProviderEnabled('openai-api')).toBe(true);
			expect(service.isProviderEnabled('openai')).toBe(true);
		});

		it('providers with no catalogId whose id the catalog has never heard of stay enabled', () => {
			service.registerProvider(makeSource('echo'));

			expect(service.isProviderEnabled('echo')).toBe(true);
			expect(service.getEnabledProviders()).toEqual(['echo']);
		});

		it('providers with no catalogId fall back to their registration id for enablement', () => {
			catalogEnabled.set('ollama', false);
			service.registerProvider(makeSource('ollama'));

			expect(service.isProviderEnabled('ollama')).toBe(false);
			expect(service.getEnabledProviders()).toEqual([]);
		});

		it('a declared catalogId the catalog has never heard of is disabled', () => {
			service.registerProvider(makeSource('ollama', 'ollama'));

			expect(service.isProviderEnabled('ollama')).toBe(false);
			expect(service.getEnabledProviders()).toEqual([]);
		});

		it('unregistered ids are not enabled even when the catalog enables them', () => {
			catalogEnabled.set('anthropic', true);

			expect(service.isProviderEnabled('anthropic')).toBe(false);
		});

		it('getProviderRegistrations keeps disabled registrations that getRegisteredSources filters out', () => {
			registerProvider('openAI', true, 'openai');
			registerProvider('anthropic-api', false, 'anthropic');

			expect(service.getRegisteredSources().map(s => s.provider.id)).toEqual(['openAI']);
			expect(service.getProviderRegistrations().map(s => s.provider.id)).toEqual(['openAI', 'anthropic-api']);
		});

		it('onChangeEnabledProviders fires on a catalog enabledChanged event', () => {
			const listener = vi.fn();
			ctx.disposables.add(service.onChangeEnabledProviders(listener));

			onDidChangeProvidersEmitter.fire(catalogChangeData({ enabledChanged: true }));
			expect(listener).toHaveBeenCalledTimes(1);
		});
	});
});
