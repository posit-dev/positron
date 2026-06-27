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
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { MockContextKeyService } from '../../../../../platform/keybinding/test/common/mockKeybindingService.js';
import { IExtensionService } from '../../../../services/extensions/common/extensions.js';
import { ExtensionIdentifier, IExtensionDescription } from '../../../../../platform/extensions/common/extensions.js';
import { ActivityItemErrorMessage } from '../../../../services/positronConsole/browser/classes/activityItemErrorMessage.js';
import { ActivityErrorMessage } from '../../browser/components/activityErrorMessage.js';

const positAssistant = { identifier: new ExtensionIdentifier('posit.assistant') } as IExtensionDescription;

// The component only reads the two output-line arrays off the error message.
const errorMessage = { messageOutputLines: [], tracebackOutputLines: [] } as unknown as ActivityItemErrorMessage;

describe('ActivityErrorMessage assistant actions gate', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.stub(IExtensionService, { extensions: [positAssistant], onDidChangeExtensions: Event.None })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	function setup(options: { aiEnabled?: boolean; actionsEnabled?: boolean; hasChatModels?: boolean }) {
		const configurationService = ctx.get(IConfigurationService) as TestConfigurationService;
		const contextKeyService = ctx.get(IContextKeyService) as MockContextKeyService;
		configurationService.setUserConfiguration('ai.enabled', options.aiEnabled ?? true);
		configurationService.setUserConfiguration('console.assistantActions.enabled', options.actionsEnabled ?? true);
		contextKeyService.createKey('posit-assistant.hasChatModels', options.hasChatModels ?? true);
	}

	it('shows Fix and Explain when enabled, installed, and a model is available', () => {
		setup({ aiEnabled: true, actionsEnabled: true, hasChatModels: true });
		rtl.render(<ActivityErrorMessage activityItemErrorMessage={errorMessage} />);
		expect(screen.getByText('Fix')).toBeInTheDocument();
		expect(screen.getByText('Explain')).toBeInTheDocument();
	});

	it('hides the actions when the AI main switch is off', () => {
		setup({ aiEnabled: false, actionsEnabled: true, hasChatModels: true });
		rtl.render(<ActivityErrorMessage activityItemErrorMessage={errorMessage} />);
		expect(screen.queryByText('Fix')).not.toBeInTheDocument();
	});

	it('hides the actions when no model is available', () => {
		setup({ actionsEnabled: true, hasChatModels: false });
		rtl.render(<ActivityErrorMessage activityItemErrorMessage={errorMessage} />);
		expect(screen.queryByText('Fix')).not.toBeInTheDocument();
	});

	it('hides the actions when the setting is disabled', () => {
		setup({ actionsEnabled: false, hasChatModels: true });
		rtl.render(<ActivityErrorMessage activityItemErrorMessage={errorMessage} />);
		expect(screen.queryByText('Fix')).not.toBeInTheDocument();
	});
});

describe('ActivityErrorMessage assistant actions gate (Posit Assistant not installed)', () => {
	const ctx = createTestContainer()
		.withReactServices()
		.stub(IExtensionService, { extensions: [], onDidChangeExtensions: Event.None })
		.build();
	const rtl = setupRTLRenderer(() => ctx.reactServices);

	it('hides the actions when Posit Assistant is not installed', () => {
		const configurationService = ctx.get(IConfigurationService) as TestConfigurationService;
		const contextKeyService = ctx.get(IContextKeyService) as MockContextKeyService;
		configurationService.setUserConfiguration('ai.enabled', true);
		configurationService.setUserConfiguration('console.assistantActions.enabled', true);
		contextKeyService.createKey('posit-assistant.hasChatModels', true);

		rtl.render(<ActivityErrorMessage activityItemErrorMessage={errorMessage} />);
		expect(screen.queryByText('Fix')).not.toBeInTheDocument();
	});
});
