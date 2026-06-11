/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { PositronAssistantConfigurationService } from '../../browser/positronAssistantService.js';
import { IPositronLanguageModelSource, PositronLanguageModelType } from '../../common/interfaces/positronAssistantService.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { INotificationService, IPromptChoice } from '../../../../../platform/notification/common/notification.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';

function makeSource(id: string): IPositronLanguageModelSource {
	return {
		type: PositronLanguageModelType.Chat,
		provider: { id, displayName: `Display ${id}`, settingName: id },
		supportedOptions: [],
		defaults: {},
	};
}

describe('PositronAssistantConfigurationService', () => {
	const configurationService = new TestConfigurationService();
	const prompt = vi.fn();
	const executeCommand = vi.fn();
	const ctx = createTestContainer()
		.stub(IConfigurationService, configurationService)
		.stub(INotificationService, { prompt })
		.stub(ICommandService, { executeCommand })
		.build();

	let service: PositronAssistantConfigurationService;

	beforeEach(() => {
		service = ctx.disposables.add(ctx.instantiationService.createInstance(PositronAssistantConfigurationService));
	});

	function registerProvider(id: string, enabled = true) {
		configurationService.setUserConfiguration(`assistant.provider.${id}.enabled`, enabled);
		service.registerProvider(makeSource(id));
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
			registerProvider('prov-disabled', false);
			service.updateProvider('prov-disabled', { status: 'error', statusMessage: 'Authentication expired' });

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
});
