/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

/* eslint-disable local/code-no-dangerous-type-assertions */

import { screen } from '@testing-library/react';
import { Event } from '../../../../../base/common/event.js';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ActivityItemErrorMessage } from '../../../../services/positronConsole/browser/classes/activityItemErrorMessage.js';
import { IErrorActionHandler, IErrorActionsService } from '../../../positronAssistant/common/errorActions.js';
import { ActivityErrorMessage } from '../../browser/components/activityErrorMessage.js';
import { IPositronConsoleInstance } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';

const positronConsoleInstance = {} as IPositronConsoleInstance;

// The component only reads the two output-line arrays off the error message.
const errorMessage = { messageOutputLines: [], tracebackOutputLines: [] } as unknown as ActivityItemErrorMessage;

const errorActionHandler: IErrorActionHandler = { id: 'test-agent', label: 'Test Agent', run: async () => { } };

describe('ActivityErrorMessage assistant actions gate', () => {
	/** The handler errors go to; undefined when there is none. */
	let configuredHandler: IErrorActionHandler | undefined;
	const ctx = createTestContainer()
		.withReactServices()
		.stub(IErrorActionsService, { onDidChange: Event.None, getConfigured: () => configuredHandler, canContinueChat: () => true })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	function setup(options: { aiEnabled?: boolean; actionsEnabled?: boolean; hasHandler?: boolean }) {
		const configurationService = ctx.get(IConfigurationService) as TestConfigurationService;
		configurationService.setUserConfiguration('ai.enabled', options.aiEnabled ?? true);
		configurationService.setUserConfiguration('console.assistantActions.enabled', options.actionsEnabled ?? true);
		configuredHandler = options.hasHandler ?? true ? errorActionHandler : undefined;
	}

	it('shows Fix and Explain when enabled and there is a handler', () => {
		setup({ aiEnabled: true, actionsEnabled: true, hasHandler: true });
		rtl.render(<ActivityErrorMessage activityItemErrorMessage={errorMessage} positronConsoleInstance={positronConsoleInstance} />);
		expect(screen.getByText('Fix')).toBeInTheDocument();
		expect(screen.getByText('Explain')).toBeInTheDocument();
	});

	it('hides the actions when the AI main switch is off', () => {
		setup({ aiEnabled: false });
		rtl.render(<ActivityErrorMessage activityItemErrorMessage={errorMessage} positronConsoleInstance={positronConsoleInstance} />);
		expect(screen.queryByText('Fix')).not.toBeInTheDocument();
	});

	it('hides the actions when there is no handler to send errors to', () => {
		setup({ hasHandler: false });
		rtl.render(<ActivityErrorMessage activityItemErrorMessage={errorMessage} positronConsoleInstance={positronConsoleInstance} />);
		expect(screen.queryByText('Fix')).not.toBeInTheDocument();
	});

	it('hides the actions when the setting is disabled', () => {
		setup({ actionsEnabled: false });
		rtl.render(<ActivityErrorMessage activityItemErrorMessage={errorMessage} positronConsoleInstance={positronConsoleInstance} />);
		expect(screen.queryByText('Fix')).not.toBeInTheDocument();
	});
});
