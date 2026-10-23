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
import { ErrorActionHandlerService } from '../../browser/errorActionHandlerService.js';
import { IErrorActionHandler, IErrorActionContext, IErrorActionHandlerService } from '../../common/errorAction.js';
import { AI_ENABLED_KEY } from '../../common/positronAIConfiguration.js';
import { registerTestErrorActionHandler } from './errorActionTestUtils.js';

describe('ErrorActionHandlerService', () => {
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

	function createService(): ErrorActionHandlerService {
		return ctx.disposables.add(ctx.instantiationService.createInstance(ErrorActionHandlerService));
	}

	function createHandler(options: Partial<IErrorActionHandler> = {}): IErrorActionHandler {
		return { id: 'test-handler', label: 'Test Assistant', supportsChatContinuation: true, ask: async () => { }, ...options };
	}

	it('makes a handler active while it is registered', () => {
		const service = createService();
		const onDidChangeActiveHandler = vi.fn();
		ctx.disposables.add(service.onDidChangeActiveHandler(onDidChangeActiveHandler));
		const handler = createHandler();

		const registration = service.register(handler);
		expect(service.activeHandler).toBe(handler);

		registration.dispose();
		expect(service.activeHandler).toBeUndefined();
		expect(onDidChangeActiveHandler.mock.calls).toEqual([[handler], [undefined]]);
	});

	it('makes the first registered handler active', () => {
		const service = createService();
		const first = createHandler({ id: 'first' });
		const onDidChangeActiveHandler = vi.fn();
		ctx.disposables.add(service.onDidChangeActiveHandler(onDidChangeActiveHandler));

		ctx.disposables.add(service.register(first));
		ctx.disposables.add(service.register(createHandler({ id: 'second' })));

		expect(service.activeHandler).toBe(first);
		expect(onDidChangeActiveHandler).toHaveBeenCalledTimes(1);
	});

	it('has no active handler while AI is disabled', () => {
		const service = createService();
		const onDidChangeActiveHandler = vi.fn();
		ctx.disposables.add(service.onDidChangeActiveHandler(onDidChangeActiveHandler));
		const handler = createHandler();
		ctx.disposables.add(service.register(handler));

		setAIEnabled(false);
		expect(service.activeHandler).toBeUndefined();

		setAIEnabled(true);
		expect(service.activeHandler).toBe(handler);
		expect(onDidChangeActiveHandler.mock.calls).toEqual([[handler], [undefined], [handler]]);
	});

	it('has no active handler while ai.enabled is unset', () => {
		configurationService = new TestConfigurationService();
		ctx.instantiationService.stub(IConfigurationService, configurationService);
		const service = createService();
		ctx.disposables.add(service.register(createHandler()));

		expect(service.activeHandler).toBeUndefined();
	});

	it('throws when a handler with the same id is already registered', () => {
		const service = createService();
		const handler = createHandler();
		ctx.disposables.add(service.register(handler));

		expect(() => service.register(createHandler())).toThrow(`An error action handler with the id 'test-handler' is already registered`);
		expect(service.activeHandler).toBe(handler);
	});

	const context: IErrorActionContext = { kind: 'console', error: 'boom', sessionId: 'python-1', sessionName: 'Python 3.12.1', languageId: 'python' };

	it('asks the handler to take the action', async () => {
		const service = createService();
		const ask = vi.fn().mockResolvedValue(undefined);
		ctx.disposables.add(service.register(createHandler({ ask })));

		await service.ask('test-handler', 'fix', context, { continueChat: true });

		expect(ask).toHaveBeenCalledWith('fix', context, { continueChat: true });
		expect(notifyError).not.toHaveBeenCalled();
	});

	it('strips ANSI escape codes from the error', async () => {
		const service = createService();
		const ask = vi.fn();
		ctx.disposables.add(service.register(createHandler({ ask })));

		await service.ask('test-handler', 'fix', { ...context, error: '\u001b[31mNameError\u001b[0m: x' }, {});

		expect(ask.mock.calls[0][1].error).toBe('NameError: x');
	});

	it('starts a new chat when the handler cannot continue the active one', async () => {
		const service = createService();
		const ask = vi.fn();
		ctx.disposables.add(service.register(createHandler({ ask, supportsChatContinuation: false })));

		await service.ask('test-handler', 'fix', context, { continueChat: true });

		expect(ask.mock.calls[0][2]).toEqual({ continueChat: false });
	});

	it('asks the handler the user saw named, not the active one', async () => {
		const service = createService();
		const askFirst = vi.fn();
		const askSecond = vi.fn();
		ctx.disposables.add(service.register(createHandler({ id: 'first', ask: askFirst })));
		ctx.disposables.add(service.register(createHandler({ id: 'second', ask: askSecond })));

		await service.ask('second', 'fix', context, {});

		expect([askFirst.mock.calls.length, askSecond.mock.calls.length]).toEqual([0, 1]);
	});

	it('does nothing while AI is disabled', async () => {
		const service = createService();
		const ask = vi.fn().mockResolvedValue(undefined);
		ctx.disposables.add(service.register(createHandler({ ask })));
		setAIEnabled(false);

		await service.ask('test-handler', 'fix', context, {});

		expect(ask).not.toHaveBeenCalled();
	});

	it('logs and warns the user when no handler has the id', async () => {
		const service = createService();

		await service.ask('removed', 'fix', context, {});

		expect(logWarn).toHaveBeenCalledWith(`No error action handler with the id 'removed' is registered`);
		expect(notifyWarn).toHaveBeenCalledWith('Could not send the error: the coding agent is no longer available.');
	});

	it('logs and notifies, rather than throws, when the handler fails', async () => {
		const service = createService();
		const error = new Error('command not found');
		ctx.disposables.add(service.register(createHandler({ ask: () => Promise.reject(error) })));

		await service.ask('test-handler', 'explain', context, {});

		expect(logError).toHaveBeenCalledWith('Failed to send the error to Test Assistant', error);
		expect(notifyError).toHaveBeenCalledWith('Could not send the error to Test Assistant: command not found');
	});
});

describe('ErrorActionHandlerService in the workbench preset', () => {
	// Stubbed after the preset runs, so the preset's service must pick it up.
	const ctx = createTestContainer()
		.withWorkbenchServices()
		.stub(IConfigurationService, new TestConfigurationService())
		.build();

	it('reads the configuration service a test stubs', () => {
		registerTestErrorActionHandler(ctx);

		expect(ctx.get(IErrorActionHandlerService).activeHandler?.id).toBe('test-handler');
	});
});
