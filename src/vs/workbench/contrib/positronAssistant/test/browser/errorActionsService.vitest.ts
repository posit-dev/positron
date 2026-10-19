/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ContextKeyService } from '../../../../../platform/contextkey/browser/contextKeyService.js';
import { ContextKeyExpr, IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { ErrorActionsService } from '../../browser/errorActionsService.js';
import { IErrorActionContext, IErrorActionHandler } from '../../common/errorActions.js';

describe('ErrorActionsService', () => {
	const logError = vi.fn();
	const notifyError = vi.fn();
	const ctx = createTestContainer()
		.stub(ILogService, { error: logError })
		.stub(INotificationService, { error: notifyError })
		.build();

	let contextKeyService: ContextKeyService;

	beforeEach(() => {
		contextKeyService = ctx.disposables.add(new ContextKeyService(new TestConfigurationService()));
		ctx.instantiationService.stub(IContextKeyService, contextKeyService);
	});

	function createService(): ErrorActionsService {
		return ctx.disposables.add(ctx.instantiationService.createInstance(ErrorActionsService));
	}

	function createHandler(options: Partial<IErrorActionHandler> = {}): IErrorActionHandler {
		return { id: 'test-agent', label: 'Test Agent', canContinueChat: true, run: async () => { }, ...options };
	}

	it('sends errors to a handler while it is registered', () => {
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

	it('sends errors to a handler only while its when is true', () => {
		const service = createService();
		const onDidChangeActiveHandler = vi.fn();
		const enabled = contextKeyService.createKey<boolean>('test.enabled', false);
		const handler = createHandler({ when: ContextKeyExpr.has('test.enabled') });
		ctx.disposables.add(service.register(handler));
		ctx.disposables.add(service.onDidChangeActiveHandler(onDidChangeActiveHandler));
		expect(service.activeHandler).toBeUndefined();

		enabled.set(true);
		expect(service.activeHandler).toBe(handler);

		enabled.set(false);
		expect(service.activeHandler).toBeUndefined();
		expect(onDidChangeActiveHandler).toHaveBeenCalledTimes(2);
	});

	it('sends errors to the first registered handler whose when is true', () => {
		const service = createService();
		contextKeyService.createKey<boolean>('test.enabled', false);
		const disabled = createHandler({ id: 'disabled', when: ContextKeyExpr.has('test.enabled') });
		const first = createHandler({ id: 'first' });
		ctx.disposables.add(service.register(disabled));
		ctx.disposables.add(service.register(first));
		ctx.disposables.add(service.register(createHandler({ id: 'second' })));

		expect(service.activeHandler).toBe(first);
	});

	it('fires only when the active handler changes', () => {
		const service = createService();
		const onDidChangeActiveHandler = vi.fn();
		ctx.disposables.add(service.onDidChangeActiveHandler(onDidChangeActiveHandler));
		contextKeyService.createKey<boolean>('test.enabled', false);

		// Activates the first handler.
		ctx.disposables.add(service.register(createHandler({ id: 'first' })));
		// Registering a later handler, or one that's disabled, leaves it active.
		ctx.disposables.add(service.register(createHandler({ id: 'second' })));
		ctx.disposables.add(service.register(createHandler({ id: 'disabled', when: ContextKeyExpr.has('test.enabled') })));

		expect(onDidChangeActiveHandler).toHaveBeenCalledTimes(1);
	});

	it('ignores and logs a handler whose id is already registered', () => {
		const service = createService();
		const handler = createHandler();
		ctx.disposables.add(service.register(handler));

		service.register(createHandler()).dispose();

		expect(service.activeHandler).toBe(handler);
		expect(logError).toHaveBeenCalledWith(`An error action handler with the id 'test-agent' is already registered`);
	});

	const context: IErrorActionContext = { error: 'boom', location: { kind: 'console' }, chat: 'new' };

	it('runs the action with the handler', async () => {
		const service = createService();
		const run = vi.fn().mockResolvedValue(undefined);

		await service.run(createHandler({ run }), 'fix', context);

		expect(run).toHaveBeenCalledWith('fix', context);
		expect(notifyError).not.toHaveBeenCalled();
	});

	it('logs and notifies, rather than throws, when the handler fails', async () => {
		const service = createService();
		const error = new Error('command not found');

		await service.run(createHandler({ run: () => Promise.reject(error) }), 'explain', context);

		expect(logError).toHaveBeenCalledWith('Failed to send the error to Test Agent', error);
		expect(notifyError).toHaveBeenCalledWith('Could not send the error to Test Agent: command not found');
	});
});
