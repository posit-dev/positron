/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { PositronAssistantConfigurationService } from '../../browser/positronAssistantService.js';
import { IPositronProviderMetadata } from '../../common/interfaces/positronAssistantService.js';

describe('PositronAssistantConfigurationService', () => {
	const disposables = ensureNoLeakedDisposables();

	let configService: TestConfigurationService;
	let service: PositronAssistantConfigurationService;

	const copilotAuthMetadata: IPositronProviderMetadata = {
		id: 'copilot-auth',
		displayName: 'GitHub Copilot',
		settingName: 'copilot',
	};
	const anthropicMetadata: IPositronProviderMetadata = {
		id: 'anthropic-api',
		displayName: 'Anthropic',
		settingName: 'anthropic',
	};

	beforeEach(() => {
		configService = new TestConfigurationService();
		service = disposables.add(new PositronAssistantConfigurationService(configService));
	});

	describe('with no provider metadata registered (Positron Assistant inactive)', () => {
		it('reports isActive = false', () => {
			expect(service.isActive).toBe(false);
		});

		it('reports copilotEnabled = true so upstream Copilot Chat is not gated', () => {
			expect(service.copilotEnabled).toBe(true);
		});

		it('reports isProviderEnabled = true for any provider id', () => {
			expect(service.isProviderEnabled('copilot')).toBe(true);
			expect(service.isProviderEnabled('anthropic-api')).toBe(true);
			expect(service.isProviderEnabled('made-up-provider')).toBe(true);
		});

		it('returns no enabled providers', () => {
			expect(service.getEnabledProviders()).toEqual([]);
		});
	});

	describe('with provider metadata registered (Positron Assistant active)', () => {
		beforeEach(() => {
			service.registerProviderMetadata(copilotAuthMetadata);
			service.registerProviderMetadata(anthropicMetadata);
		});

		it('reports isActive = true', () => {
			expect(service.isActive).toBe(true);
		});

		it('honors the underlying _copilotEnabled flag', () => {
			expect(service.copilotEnabled).toBe(false);
			service.copilotEnabled = true;
			expect(service.copilotEnabled).toBe(true);
		});

		it('reads enabled providers from per-provider settings', async () => {
			await configService.setUserConfiguration('positron.assistant.provider.anthropic.enable', true);
			await configService.setUserConfiguration('positron.assistant.provider.copilot.enable', false);
			expect(service.getEnabledProviders()).toEqual(['anthropic-api']);
		});

		it('treats the copilot vendor as enabled when the copilot-auth provider is enabled', async () => {
			await configService.setUserConfiguration('positron.assistant.provider.copilot.enable', true);
			expect(service.isProviderEnabled('copilot-auth')).toBe(true);
			expect(service.isProviderEnabled('copilot')).toBe(true);
		});

		it('reports unknown providers as disabled', () => {
			expect(service.isProviderEnabled('made-up-provider')).toBe(false);
		});
	});
});
