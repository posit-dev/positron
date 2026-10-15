/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

/* eslint-disable local/code-no-dangerous-type-assertions */

import { screen } from '@testing-library/react';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ActivityItemErrorMessage } from '../../../../services/positronConsole/browser/classes/activityItemErrorMessage.js';
import { ErrorActionsService } from '../../../positronAssistant/browser/errorActionsService.js';
import { IErrorActionsService } from '../../../positronAssistant/common/errorActions.js';
import { ActivityErrorMessage } from '../../browser/components/activityErrorMessage.js';

// The component only reads the two output-line arrays off the error message.
const errorMessage = { messageOutputLines: [], tracebackOutputLines: [] } as unknown as ActivityItemErrorMessage;

describe('ActivityErrorMessage assistant actions gate', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.build();

	// Replace the preset's inert stub with a real service, so tests can register handlers.
	beforeEach(() => {
		ctx.instantiationService.stub(IErrorActionsService, ctx.disposables.add(ctx.instantiationService.createInstance(ErrorActionsService)));
	});
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	// Give errors somewhere to go, so only the console's own gates are tested.
	beforeEach(() => {
		ctx.disposables.add(ctx.get(IErrorActionsService).register({ id: 'test-agent', label: 'Test Agent', canContinueChat: true, run: async () => { } }));
	});

	function setup(options: { aiEnabled?: boolean; actionsEnabled?: boolean }) {
		const configurationService = ctx.get(IConfigurationService) as TestConfigurationService;
		configurationService.setUserConfiguration('ai.enabled', options.aiEnabled ?? true);
		configurationService.setUserConfiguration('console.assistantActions.enabled', options.actionsEnabled ?? true);
	}

	it('shows Fix and Explain when AI and the console setting are enabled', () => {
		setup({ aiEnabled: true, actionsEnabled: true });
		rtl.render(<ActivityErrorMessage activityItemErrorMessage={errorMessage} />);
		expect(screen.getByText('Fix')).toBeInTheDocument();
		expect(screen.getByText('Explain')).toBeInTheDocument();
	});

	it('hides the actions when the AI main switch is off', () => {
		setup({ aiEnabled: false, actionsEnabled: true });
		rtl.render(<ActivityErrorMessage activityItemErrorMessage={errorMessage} />);
		expect(screen.queryByText('Fix')).not.toBeInTheDocument();
	});

	it('hides the actions when the setting is disabled', () => {
		setup({ actionsEnabled: false });
		rtl.render(<ActivityErrorMessage activityItemErrorMessage={errorMessage} />);
		expect(screen.queryByText('Fix')).not.toBeInTheDocument();
	});
});
