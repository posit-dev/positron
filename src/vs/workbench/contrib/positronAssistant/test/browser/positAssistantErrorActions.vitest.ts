/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

/* eslint-disable local/code-no-dangerous-type-assertions */

import { Emitter } from '../../../../../base/common/event.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { ContextKeyService } from '../../../../../platform/contextkey/browser/contextKeyService.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { ExtensionIdentifier, IExtensionDescription } from '../../../../../platform/extensions/common/extensions.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { IExtensionService } from '../../../../services/extensions/common/extensions.js';
import { ErrorActionsService } from '../../browser/errorActionsService.js';
import { PositAssistantErrorActionsContribution } from '../../browser/positAssistantErrorActions.js';
import { POSIT_HAS_CHAT_MODELS_KEY } from '../../browser/positAssistantChat.js';
import { IErrorActionsService } from '../../common/errorActions.js';

describe('PositAssistantErrorActionsContribution', () => {
	const ctx = createTestContainer().withWorkbenchServices().build();

	const positAssistant = { identifier: new ExtensionIdentifier('posit.assistant') } as IExtensionDescription;

	let contextKeyService: ContextKeyService;
	let extensions: IExtensionDescription[];
	let onDidChangeExtensions: Emitter<{ readonly added: IExtensionDescription[]; readonly removed: IExtensionDescription[] }>;
	let errorActionsService: ErrorActionsService;

	beforeEach(() => {
		contextKeyService = ctx.disposables.add(new ContextKeyService(ctx.get(IConfigurationService)));
		ctx.instantiationService.stub(IContextKeyService, contextKeyService);

		extensions = [positAssistant];
		onDidChangeExtensions = ctx.disposables.add(new Emitter());
		ctx.instantiationService.stub(IExtensionService, {
			get extensions() { return extensions; },
			onDidChangeExtensions: onDidChangeExtensions.event,
		});

		errorActionsService = ctx.disposables.add(ctx.instantiationService.createInstance(ErrorActionsService));
		ctx.instantiationService.stub(IErrorActionsService, errorActionsService);
	});

	function createContribution() {
		ctx.disposables.add(ctx.instantiationService.createInstance(PositAssistantErrorActionsContribution));
	}

	it('takes errors only while Posit Assistant has a chat model', () => {
		const hasChatModels = contextKeyService.createKey<boolean>(POSIT_HAS_CHAT_MODELS_KEY, false);
		createContribution();
		expect(errorActionsService.getHandler()).toBeUndefined();

		hasChatModels.set(true);
		expect(errorActionsService.getHandler()).toBeDefined();
	});

	it('takes errors only while Posit Assistant is installed', () => {
		contextKeyService.createKey(POSIT_HAS_CHAT_MODELS_KEY, true);
		extensions = [];
		createContribution();
		expect(errorActionsService.getHandler()).toBeUndefined();

		extensions = [positAssistant];
		onDidChangeExtensions.fire({ added: [], removed: [] });
		expect(errorActionsService.getHandler()).toBeDefined();

		extensions = [];
		onDidChangeExtensions.fire({ added: [], removed: [] });
		expect(errorActionsService.getHandler()).toBeUndefined();
	});
});
