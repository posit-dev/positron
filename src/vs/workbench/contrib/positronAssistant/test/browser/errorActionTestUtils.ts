/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore, IDisposable } from '../../../../../base/common/lifecycle.js';
import { IConfigurationChangeEvent, IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ServiceIdentifier } from '../../../../../platform/instantiation/common/instantiation.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IErrorActionHandler, IErrorActionHandlerService } from '../../common/errorAction.js';
import { AI_ENABLED_KEY } from '../../common/positronAIConfiguration.js';
import { DEFAULT_ERROR_ACTION_HANDLER_ID, ERROR_ACTIONS_AGENT_KEY } from '../../common/positronAIConfigurationKeys.js';

/** A test container with a TestConfigurationService and an error action handler service. */
interface IErrorActionTestContainer {
	get: <T>(id: ServiceIdentifier<T>) => T;
	disposables: Pick<DisposableStore, 'add'>;
}

/**
 * Set a setting and fire the change, as the real configuration service does.
 */
export function setTestConfiguration(ctx: Pick<IErrorActionTestContainer, 'get'>, key: string, value: unknown): void {
	const configurationService = ctx.get(IConfigurationService) as TestConfigurationService;
	configurationService.setUserConfiguration(key, value);
	configurationService.onDidChangeConfigurationEmitter.fire(
		stubInterface<IConfigurationChangeEvent>({ affectsConfiguration: (changed: string) => changed === key })
	);
}

/**
 * Turn AI on, and register and choose a handler, so that errors have
 * somewhere to go.
 * @returns The handler's registration, disposed after the test.
 */
export function registerTestErrorActionHandler(ctx: IErrorActionTestContainer, overrides: Partial<IErrorActionHandler> = {}): IDisposable {
	const handler: IErrorActionHandler = {
		id: 'test-handler',
		label: 'Test Assistant',
		supportsChatContinuation: true,
		ask: async () => { },
		...overrides,
	};
	setTestConfiguration(ctx, AI_ENABLED_KEY, true);
	setTestConfiguration(ctx, ERROR_ACTIONS_AGENT_KEY, handler.id);
	return ctx.disposables.add(ctx.get(IErrorActionHandlerService).register(handler));
}

/**
 * Choose the default handler, which is never registered in tests, so that
 * errors have nowhere to go.
 */
export function chooseHiddenErrorActionHandler(ctx: Pick<IErrorActionTestContainer, 'get'>): void {
	setTestConfiguration(ctx, ERROR_ACTIONS_AGENT_KEY, DEFAULT_ERROR_ACTION_HANDLER_ID);
}
