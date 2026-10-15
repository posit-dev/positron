/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ContextKeyService } from '../../../../../platform/contextkey/browser/contextKeyService.js';
import { ContextKeyExpr, IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { ErrorActionsService } from '../../browser/errorActionsService.js';
import { IErrorActionHandler, POSIT_ASSISTANT_ERROR_ACTIONS_ID } from '../../common/errorActions.js';

describe('ErrorActionsService', () => {
	const logError = vi.fn();
	const ctx = createTestContainer()
		.stub(ILogService, { error: logError })
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
		return { id: POSIT_ASSISTANT_ERROR_ACTIONS_ID, run: async () => { }, ...options };
	}

	it('sends errors to Posit Assistant while it is registered', () => {
		const service = createService();
		const onDidChange = vi.fn();
		ctx.disposables.add(service.onDidChange(onDidChange));
		const handler = createHandler();

		const registration = service.register(handler);
		expect(service.getHandler()).toBe(handler);

		registration.dispose();
		expect(service.getHandler()).toBeUndefined();
		expect(onDidChange).toHaveBeenCalledTimes(2);
	});

	it('sends errors to Posit Assistant only while its when is true', () => {
		const service = createService();
		const onDidChange = vi.fn();
		const enabled = contextKeyService.createKey<boolean>('test.enabled', false);
		const handler = createHandler({ when: ContextKeyExpr.has('test.enabled') });
		ctx.disposables.add(service.register(handler));
		ctx.disposables.add(service.onDidChange(onDidChange));
		expect(service.getHandler()).toBeUndefined();

		enabled.set(true);
		expect(service.getHandler()).toBe(handler);

		enabled.set(false);
		expect(service.getHandler()).toBeUndefined();
		expect(onDidChange).toHaveBeenCalledTimes(2);
	});

	it('ignores other handlers', () => {
		const service = createService();
		ctx.disposables.add(service.register(createHandler({ id: 'other' })));

		expect(service.getHandler()).toBeUndefined();
	});

	it('ignores and logs a handler whose id is already registered', () => {
		const service = createService();
		const handler = createHandler();
		ctx.disposables.add(service.register(handler));

		service.register(createHandler()).dispose();

		expect(service.getHandler()).toBe(handler);
		expect(logError).toHaveBeenCalledWith(`An error action handler with the id '${POSIT_ASSISTANT_ERROR_ACTIONS_ID}' is already registered`);
	});
});
