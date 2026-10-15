/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable local/code-no-dangerous-type-assertions */

import { Event } from '../../../../../base/common/event.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { ContextKeyService } from '../../../../../platform/contextkey/browser/contextKeyService.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { ExtensionIdentifier, IExtensionDescription } from '../../../../../platform/extensions/common/extensions.js';
import { ServiceIdentifier } from '../../../../../platform/instantiation/common/instantiation.js';
import { TestInstantiationService } from '../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { IExtensionService } from '../../../../services/extensions/common/extensions.js';
import { ErrorActionsService } from '../../browser/errorActionsService.js';
import { PositAssistantErrorActionsContribution } from '../../browser/positAssistantErrorActions.js';
import { IErrorActionsService } from '../../common/errorActions.js';

/** The parts of a test container that {@link registerPositAssistantErrorActions} uses. */
interface ITestContainer {
	readonly instantiationService: TestInstantiationService;
	readonly disposables: Pick<DisposableStore, 'add'>;
	get<T>(id: ServiceIdentifier<T>): T;
}

/**
 * Register Posit Assistant's error action handler as the workbench does, on a
 * real context key service so its `when` is evaluated. Call in `beforeEach`,
 * after the container's own stubs apply, so the handler uses the stubbed
 * command and notification services.
 * @param options.installed Whether Posit Assistant is installed. Defaults to true.
 * @returns The context key service. Set `posit-assistant.hasChatModels` on it
 *   to let the handler take errors.
 */
export function registerPositAssistantErrorActions(ctx: ITestContainer, options: { installed?: boolean } = {}): ContextKeyService {
	const contextKeyService = ctx.disposables.add(new ContextKeyService(ctx.get(IConfigurationService)));
	ctx.instantiationService.stub(IContextKeyService, contextKeyService);

	const extensions = options.installed === false ? [] : [{ identifier: new ExtensionIdentifier('posit.assistant') } as IExtensionDescription];
	ctx.instantiationService.stub(IExtensionService, { extensions, onDidChangeExtensions: Event.None });

	// Replace the preset's service, which was built on the mock context key service.
	ctx.instantiationService.stub(IErrorActionsService, ctx.disposables.add(ctx.instantiationService.createInstance(ErrorActionsService)));
	ctx.disposables.add(ctx.instantiationService.createInstance(PositAssistantErrorActionsContribution));
	return contextKeyService;
}
