/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore, IDisposable } from '../../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ServiceIdentifier } from '../../../../../platform/instantiation/common/instantiation.js';
import { IErrorAssistant, IErrorAssistantService } from '../../common/errorAssistant.js';
import { AI_ENABLED_KEY } from '../../common/positronAIConfiguration.js';

/** A test container with a TestConfigurationService and an error assistant service. */
interface IErrorAssistantTestContainer {
	get: <T>(id: ServiceIdentifier<T>) => T;
	disposables: Pick<DisposableStore, 'add'>;
}

/**
 * Turn AI on and register an assistant, so that errors have somewhere to go.
 * @returns The assistant's registration, disposed after the test.
 */
export function registerTestErrorAssistant(ctx: IErrorAssistantTestContainer, overrides: Partial<IErrorAssistant> = {}): IDisposable {
	(ctx.get(IConfigurationService) as TestConfigurationService).setUserConfiguration(AI_ENABLED_KEY, true);
	return ctx.disposables.add(ctx.get(IErrorAssistantService).register({
		id: 'test-agent',
		label: 'Test Agent',
		supportsChatContinuation: true,
		ask: async () => { },
		...overrides,
	}));
}
