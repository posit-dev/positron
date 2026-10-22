/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

/* eslint-disable local/code-no-dangerous-type-assertions */

import { screen } from '@testing-library/react';
import { setupRTLRenderer } from '../../../../../test/vitest/reactTestingLibrary.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { IPositronConsoleInstance } from '../../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../platform/configuration/test/common/testConfigurationService.js';
import { ActivityItemErrorMessage } from '../../../../services/positronConsole/browser/classes/activityItemErrorMessage.js';
import { registerTestErrorAssistant } from '../../../positronAssistant/test/browser/errorAssistantTestUtils.js';
import { ActivityErrorMessage } from '../../browser/components/activityErrorMessage.js';

// The component only reads the two output-line arrays off the error message.
const errorMessage = { messageOutputLines: [], tracebackOutputLines: [] } as unknown as ActivityItemErrorMessage;

// The console is only read when an action is taken.
const positronConsoleInstance = stubInterface<IPositronConsoleInstance>({});

describe('ActivityErrorMessage assistant actions gate', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.build();

	const rtl = setupRTLRenderer(() => ctx.reactServices);

	// Give errors somewhere to go, so only the console's own gate is tested.
	beforeEach(() => {
		registerTestErrorAssistant(ctx);
	});

	function setup(options: { actionsEnabled?: boolean }) {
		const configurationService = ctx.get(IConfigurationService) as TestConfigurationService;
		configurationService.setUserConfiguration('console.assistantActions.enabled', options.actionsEnabled ?? true);
	}

	it('shows Fix and Explain when the setting is enabled', () => {
		setup({ actionsEnabled: true });
		rtl.render(<ActivityErrorMessage activityItemErrorMessage={errorMessage} positronConsoleInstance={positronConsoleInstance} />);
		expect(screen.getByText('Fix')).toBeInTheDocument();
		expect(screen.getByText('Explain')).toBeInTheDocument();
	});

	it('hides the actions when the setting is disabled', () => {
		setup({ actionsEnabled: false });
		rtl.render(<ActivityErrorMessage activityItemErrorMessage={errorMessage} positronConsoleInstance={positronConsoleInstance} />);
		expect(screen.queryByText('Fix')).not.toBeInTheDocument();
	});
});
