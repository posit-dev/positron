/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Emitter } from '../../../../../base/common/event.js';
import { ContextKeyExpr, ContextKeyExpression, IContextKeyChangeEvent, IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { IErrorActionContext, IErrorActionHandler } from '../../common/errorActions.js';
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

	/** Summarize the registered handlers as the agent picker offers them. */
	function getRegisteredSummary(service: ErrorActionsService) {
		return service.getRegistered().map(({ handler, isEnabled, problem }) => ({ id: handler.id, isEnabled, problem }));
	}

	beforeEach(() => {
		ctx.get(IStorageService).store('positron.errorActions.selectedAgent', 'test-agent', StorageScope.PROFILE, StorageTarget.USER);
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

	it('uses Posit Assistant until another is selected', () => {
		ctx.get(IStorageService).remove('positron.errorActions.selectedAgent', StorageScope.PROFILE);
		const service = createService();
		const errorActionHandler = createErrorActionHandler();
		const positAssistant = createErrorActionHandler('posit-assistant', 'Posit Assistant');
		ctx.disposables.add(service.register(errorActionHandler));
		ctx.disposables.add(service.register(positAssistant));
		expect(service.getConfigured()).toBe(positAssistant);

		const onDidChange = vi.fn();
		ctx.disposables.add(service.onDidChange(onDidChange));
		service.select('test-agent');
		expect(onDidChange).toHaveBeenCalledTimes(1);
		expect(service.getConfigured()).toBe(errorActionHandler);
	});

	it('shares the selection across workspaces', () => {
		createService().select('posit-assistant');
		expect(createService().selectedId).toBe('posit-assistant');
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

	it('lists registered handlers Posit Assistant first, with whether they can take errors', () => {
		const service = createService();
		const registration = service.register({ ...createErrorActionHandler(), when: ContextKeyExpr.has('testAgent.isInstalled') });
		ctx.disposables.add(service.register(createErrorActionHandler('posit-assistant', 'Posit Assistant')));
		expect(getRegisteredSummary(service)).toEqual([
			{ id: 'posit-assistant', isEnabled: true, problem: undefined },
			{ id: 'test-agent', isEnabled: false, problem: undefined },
		]);

		registration.dispose();
		expect(getRegisteredSummary(service).map(({ id }) => id)).toEqual(['posit-assistant']);
	});

	it('tracks what keeps a handler from working fully', () => {
		const service = createService();
		const registration = service.register(createErrorActionHandler());
		ctx.disposables.add(registration);
		const onDidChange = vi.fn();
		ctx.disposables.add(service.onDidChange(onDidChange));

		registration.setProblem('The test command was not found.');
		expect(getRegisteredSummary(service)).toEqual([{ id: 'test-agent', isEnabled: true, problem: 'The test command was not found.' }]);
		expect(onDidChange).toHaveBeenCalledTimes(1);
	});

	it('tracks whether a handler can continue the current chat', () => {
		const service = createService();
		const errorActionHandler = createErrorActionHandler();
		const registration = service.register(errorActionHandler);
		ctx.disposables.add(registration);
		const onDidChange = vi.fn();
		ctx.disposables.add(service.onDidChange(onDidChange));
		expect(service.canContinueChat(errorActionHandler)).toBe(true);

		registration.setCanContinueChat(false);
		expect(service.canContinueChat(errorActionHandler)).toBe(false);
		expect(onDidChange).toHaveBeenCalledTimes(1);
	});

	it('ignores duplicate ids', () => {
		const service = createService();
		const first = createErrorActionHandler();
		ctx.disposables.add(service.register(first));
		ctx.disposables.add(service.register(createErrorActionHandler()));

		expect(getRegisteredSummary(service).map(({ id }) => id)).toEqual(['test-agent']);
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
