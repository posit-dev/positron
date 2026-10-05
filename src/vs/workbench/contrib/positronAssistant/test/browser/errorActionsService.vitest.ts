/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../../platform/configuration/common/configurationRegistry.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { ERROR_ACTIONS_TARGET_KEY, IErrorActionContext, IErrorActionHandler } from '../../common/errorActions.js';
import { ErrorActionsService } from '../../browser/errorActionsService.js';

const context: IErrorActionContext = { error: 'boom' };

describe('ErrorActionsService', () => {
	const notifyError = vi.fn();

	const ctx = createTestContainer()
		.withWorkbenchServices()
		.stub(INotificationService, { error: notifyError })
		.build();

	function createService() {
		const service = ctx.instantiationService.createInstance(ErrorActionsService);
		ctx.disposables.add(service);
		return service;
	}

	function createErrorActionHandler(id = 'test-agent'): IErrorActionHandler {
		return { id, label: 'Test Agent', run: vi.fn().mockResolvedValue(undefined) };
	}

	function getSettingOptions() {
		return Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration)
			.getConfigurationProperties()[ERROR_ACTIONS_TARGET_KEY].enum;
	}

	beforeEach(() => {
		(ctx.get(IConfigurationService) as TestConfigurationService).setUserConfiguration(ERROR_ACTIONS_TARGET_KEY, 'test-agent');
	});

	it('uses the selected error action handler while it is registered', () => {
		const service = createService();
		const errorActionHandler = createErrorActionHandler();
		expect(service.getConfigured()).toBeUndefined();

		const registration = service.register(errorActionHandler);
		expect(service.getConfigured()).toBe(errorActionHandler);

		registration.dispose();
		expect(service.getConfigured()).toBeUndefined();
	});

	it('falls back to Posit Assistant when it is selected', () => {
		const service = createService();
		ctx.disposables.add(service.register(createErrorActionHandler()));
		(ctx.get(IConfigurationService) as TestConfigurationService).setUserConfiguration(ERROR_ACTIONS_TARGET_KEY, 'posit-assistant');

		expect(service.getConfigured()).toBeUndefined();
	});

	it('lists registered error action handlers in the setting options', () => {
		const service = createService();
		const registration = service.register(createErrorActionHandler());
		expect(getSettingOptions()).toEqual(['posit-assistant', 'test-agent']);

		registration.dispose();
		expect(getSettingOptions()).toEqual(['posit-assistant']);
	});

	it('ignores the reserved posit-assistant id and duplicate ids', () => {
		const service = createService();
		const first = createErrorActionHandler();
		ctx.disposables.add(service.register(first));
		ctx.disposables.add(service.register(createErrorActionHandler('posit-assistant')));
		ctx.disposables.add(service.register(createErrorActionHandler()));

		expect(getSettingOptions()).toEqual(['posit-assistant', 'test-agent']);
		expect(service.getConfigured()).toBe(first);
	});

	it('runs the action with the error', async () => {
		const service = createService();
		const errorActionHandler = createErrorActionHandler();
		await service.run(errorActionHandler, 'explain', context);
		expect(errorActionHandler.run).toHaveBeenCalledWith('explain', context, CancellationToken.None);
	});

	it('surfaces a notification when the action fails', async () => {
		const service = createService();
		const errorActionHandler = createErrorActionHandler();
		vi.mocked(errorActionHandler.run).mockRejectedValueOnce(new Error('extension host stopped'));
		await service.run(errorActionHandler, 'fix', context);
		expect(notifyError).toHaveBeenCalledWith('Could not send the error to Test Agent: extension host stopped');
	});
});
