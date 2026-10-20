/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { IConfigurationChangeEvent, IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { ErrorAssistantService } from '../../browser/errorAssistantService.js';
import { IErrorAssistant, IErrorAssistantContext } from '../../common/errorAssistant.js';
import { AI_ENABLED_KEY } from '../../common/positronAIConfiguration.js';

describe('ErrorAssistantService', () => {
	const logError = vi.fn();
	const logWarn = vi.fn();
	const notifyError = vi.fn();
	const notifyWarn = vi.fn();
	const ctx = createTestContainer()
		.stub(ILogService, { error: logError, warn: logWarn })
		.stub(INotificationService, { error: notifyError, warn: notifyWarn })
		.build();

	let configurationService: TestConfigurationService;

	beforeEach(() => {
		configurationService = new TestConfigurationService({ [AI_ENABLED_KEY]: true });
		ctx.instantiationService.stub(IConfigurationService, configurationService);
	});

	function setAIEnabled(enabled: boolean): void {
		configurationService.setUserConfiguration(AI_ENABLED_KEY, enabled);
		configurationService.onDidChangeConfigurationEmitter.fire(
			stubInterface<IConfigurationChangeEvent>({ affectsConfiguration: (key: string) => key === AI_ENABLED_KEY })
		);
	}

	function createService(): ErrorAssistantService {
		return ctx.disposables.add(ctx.instantiationService.createInstance(ErrorAssistantService));
	}

	function createAssistant(options: Partial<IErrorAssistant> = {}): IErrorAssistant {
		return { id: 'test-agent', label: 'Test Agent', supportsChatContinuation: true, ask: async () => { }, ...options };
	}

	it('sends errors to an assistant while it is registered', () => {
		const service = createService();
		const onDidChangeActiveAssistant = vi.fn();
		ctx.disposables.add(service.onDidChangeActiveAssistant(onDidChangeActiveAssistant));
		const assistant = createAssistant();

		const registration = service.register(assistant);
		expect(service.activeAssistant).toBe(assistant);

		registration.dispose();
		expect(service.activeAssistant).toBeUndefined();
		expect(onDidChangeActiveAssistant.mock.calls).toEqual([[assistant], [undefined]]);
	});

	it('sends errors to the first registered assistant', () => {
		const service = createService();
		const first = createAssistant({ id: 'first' });
		const onDidChangeActiveAssistant = vi.fn();
		ctx.disposables.add(service.onDidChangeActiveAssistant(onDidChangeActiveAssistant));

		ctx.disposables.add(service.register(first));
		ctx.disposables.add(service.register(createAssistant({ id: 'second' })));

		expect(service.activeAssistant).toBe(first);
		expect(onDidChangeActiveAssistant).toHaveBeenCalledTimes(1);
	});

	it('has no active assistant while AI is disabled', () => {
		const service = createService();
		const onDidChangeActiveAssistant = vi.fn();
		ctx.disposables.add(service.onDidChangeActiveAssistant(onDidChangeActiveAssistant));
		const assistant = createAssistant();
		ctx.disposables.add(service.register(assistant));

		setAIEnabled(false);
		expect(service.activeAssistant).toBeUndefined();

		setAIEnabled(true);
		expect(service.activeAssistant).toBe(assistant);
		expect(onDidChangeActiveAssistant.mock.calls).toEqual([[assistant], [undefined], [assistant]]);
	});

	it('has no active assistant while ai.enabled is unset', () => {
		configurationService = new TestConfigurationService();
		ctx.instantiationService.stub(IConfigurationService, configurationService);
		const service = createService();
		ctx.disposables.add(service.register(createAssistant()));

		expect(service.activeAssistant).toBeUndefined();
	});

	it('throws when an assistant with the same id is already registered', () => {
		const service = createService();
		const assistant = createAssistant();
		ctx.disposables.add(service.register(assistant));

		expect(() => service.register(createAssistant())).toThrow(`An error assistant with the id 'test-agent' is already registered`);
		expect(service.activeAssistant).toBe(assistant);
	});

	const context: IErrorAssistantContext = { kind: 'console', error: 'boom' };

	it('asks the assistant to take the action', async () => {
		const service = createService();
		const ask = vi.fn().mockResolvedValue(undefined);
		ctx.disposables.add(service.register(createAssistant({ ask })));

		await service.ask('test-agent', 'fix', context, { continueChat: true });

		expect(ask).toHaveBeenCalledWith('fix', context, { continueChat: true });
		expect(notifyError).not.toHaveBeenCalled();
	});

	it('strips ANSI escape codes from the error', async () => {
		const service = createService();
		const ask = vi.fn();
		ctx.disposables.add(service.register(createAssistant({ ask })));

		await service.ask('test-agent', 'fix', { kind: 'console', error: '\u001b[31mNameError\u001b[0m: x' }, {});

		expect(ask.mock.calls[0][1].error).toBe('NameError: x');
	});

	it('starts a new chat when the assistant cannot continue the active one', async () => {
		const service = createService();
		const ask = vi.fn();
		ctx.disposables.add(service.register(createAssistant({ ask, supportsChatContinuation: false })));

		await service.ask('test-agent', 'fix', context, { continueChat: true });

		expect(ask.mock.calls[0][2]).toEqual({ continueChat: false });
	});

	it('asks the assistant the user saw named, not the active one', async () => {
		const service = createService();
		const askFirst = vi.fn();
		const askSecond = vi.fn();
		ctx.disposables.add(service.register(createAssistant({ id: 'first', ask: askFirst })));
		ctx.disposables.add(service.register(createAssistant({ id: 'second', ask: askSecond })));

		await service.ask('second', 'fix', context, {});

		expect([askFirst.mock.calls.length, askSecond.mock.calls.length]).toEqual([0, 1]);
	});

	it('does nothing while AI is disabled', async () => {
		const service = createService();
		const ask = vi.fn().mockResolvedValue(undefined);
		ctx.disposables.add(service.register(createAssistant({ ask })));
		setAIEnabled(false);

		await service.ask('test-agent', 'fix', context, {});

		expect(ask).not.toHaveBeenCalled();
	});

	it('logs and warns the user when no assistant has the id', async () => {
		const service = createService();

		await service.ask('removed', 'fix', context, {});

		expect(logWarn).toHaveBeenCalledWith(`No error assistant with the id 'removed' is registered`);
		expect(notifyWarn).toHaveBeenCalledWith('Could not send the error: the assistant is no longer available.');
	});

	it('logs and notifies, rather than throws, when the assistant fails', async () => {
		const service = createService();
		const error = new Error('command not found');
		ctx.disposables.add(service.register(createAssistant({ ask: () => Promise.reject(error) })));

		await service.ask('test-agent', 'explain', context, {});

		expect(logError).toHaveBeenCalledWith('Failed to send the error to Test Agent', error);
		expect(notifyError).toHaveBeenCalledWith('Could not send the error to Test Agent: command not found');
	});
});
