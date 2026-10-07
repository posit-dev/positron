/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Emitter } from '../../../../../base/common/event.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../../platform/configuration/common/configurationRegistry.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ContextKeyExpr, ContextKeyExpression, IContextKeyChangeEvent, IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { ERROR_ACTIONS_TARGET_KEY, IErrorActionContext, IErrorActionHandler } from '../../common/errorActions.js';
import { ErrorActionsService } from '../../browser/errorActionsService.js';

const context: IErrorActionContext = { error: 'boom', chat: 'new' };

describe('ErrorActionsService', () => {
	const notifyError = vi.fn();
	const onDidChangeContext = new Emitter<IContextKeyChangeEvent>();
	/** Context keys that are true. */
	const trueKeys = new Set<string>();

	const ctx = createTestContainer()
		.withWorkbenchServices()
		.stub(INotificationService, { error: notifyError })
		.stub(IContextKeyService, {
			onDidChangeContext: onDidChangeContext.event,
			contextMatchesRules: (rules: ContextKeyExpression | undefined) => !rules || rules.keys().every(key => trueKeys.has(key)),
		})
		.build();

	/** Set a context key and announce the change. */
	function setContextKey(key: string, value: boolean) {
		if (value) {
			trueKeys.add(key);
		} else {
			trueKeys.delete(key);
		}
		onDidChangeContext.fire({ affectsSome: keys => keys.has(key), allKeysContainedIn: keys => keys.has(key) });
	}

	function createService() {
		const service = ctx.instantiationService.createInstance(ErrorActionsService);
		ctx.disposables.add(service);
		return service;
	}

	function createErrorActionHandler(id = 'test-agent', label = 'Test Agent'): IErrorActionHandler {
		return { id, label, run: vi.fn().mockResolvedValue(undefined) };
	}

	function getSettingOptions() {
		return Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration)
			.getConfigurationProperties()[ERROR_ACTIONS_TARGET_KEY].enum;
	}

	beforeEach(() => {
		(ctx.get(IConfigurationService) as TestConfigurationService).setUserConfiguration(ERROR_ACTIONS_TARGET_KEY, 'test-agent');
		trueKeys.clear();
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

	it('uses Posit Assistant when it is selected', () => {
		const service = createService();
		const positAssistant = createErrorActionHandler('posit-assistant', 'Posit Assistant');
		ctx.disposables.add(service.register(createErrorActionHandler()));
		ctx.disposables.add(service.register(positAssistant));
		(ctx.get(IConfigurationService) as TestConfigurationService).setUserConfiguration(ERROR_ACTIONS_TARGET_KEY, 'posit-assistant');

		expect(service.getConfigured()).toBe(positAssistant);
	});

	it('falls back to Posit Assistant while the selected handler is not registered', () => {
		const service = createService();
		const positAssistant = createErrorActionHandler('posit-assistant', 'Posit Assistant');
		ctx.disposables.add(service.register(positAssistant));

		expect(service.getConfigured()).toBe(positAssistant);
	});

	it('falls back to Posit Assistant while the selected handler\'s when is false', () => {
		const service = createService();
		const errorActionHandler = { ...createErrorActionHandler(), when: ContextKeyExpr.has('testAgent.isInstalled') };
		const positAssistant = createErrorActionHandler('posit-assistant', 'Posit Assistant');
		ctx.disposables.add(service.register(errorActionHandler));
		ctx.disposables.add(service.register(positAssistant));
		const onDidChange = vi.fn();
		ctx.disposables.add(service.onDidChange(onDidChange));
		expect(service.getConfigured()).toBe(positAssistant);

		setContextKey('testAgent.isInstalled', true);
		expect(onDidChange).toHaveBeenCalledTimes(1);
		expect(service.getConfigured()).toBe(errorActionHandler);
	});

	it('lists registered error action handlers in the setting options, after Posit Assistant', () => {
		const service = createService();
		const registration = service.register(createErrorActionHandler());
		ctx.disposables.add(service.register(createErrorActionHandler('posit-assistant', 'Posit Assistant')));
		expect(getSettingOptions()).toEqual(['posit-assistant', 'test-agent']);

		registration.dispose();
		expect(getSettingOptions()).toEqual(['posit-assistant']);
	});

	it('ignores duplicate ids', () => {
		const service = createService();
		const first = createErrorActionHandler();
		ctx.disposables.add(service.register(first));
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
