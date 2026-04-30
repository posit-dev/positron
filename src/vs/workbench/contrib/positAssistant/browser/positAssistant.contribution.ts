/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Event } from '../../../../base/common/event.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IWorkbenchContribution, IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from '../../../common/contributions.js';
import { LifecyclePhase } from '../../../services/lifecycle/common/lifecycle.js';
import { IWorkbenchExtensionEnablementService } from '../../../services/extensionManagement/common/extensionManagement.js';
import { IExtension, IExtensionsWorkbenchService } from '../../extensions/common/extensions.js';
import { POSIT_ASSISTANT_AVAILABLE, POSIT_ASSISTANT_EXTENSION_ID } from '../common/positAssistantContextKeys.js';

/**
 * Contribution that tracks whether the optional `posit.assistant` extension is
 * installed and enabled, and exposes that as the `positron.positAssistantAvailable`
 * context key.
 */
export class PositAssistantContextKeyContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.positAssistantContextKey';

	private readonly _positAssistantAvailable: IContextKey<boolean>;

	readonly whenInitialized: Promise<void>;

	constructor(
		@IContextKeyService contextKeyService: IContextKeyService,
		@IExtensionsWorkbenchService private readonly extensionsWorkbenchService: IExtensionsWorkbenchService,
		@IWorkbenchExtensionEnablementService private readonly extensionEnablementService: IWorkbenchExtensionEnablementService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		this._positAssistantAvailable = POSIT_ASSISTANT_AVAILABLE.bindTo(contextKeyService);
		this.whenInitialized = this._initialize().catch(err => this.logService.error(err));
	}

	private async _initialize(): Promise<void> {
		await this.extensionsWorkbenchService.queryLocal();

		this._register(Event.runAndSubscribe<IExtension | undefined>(this.extensionsWorkbenchService.onChange, e => {
			if (e && !ExtensionIdentifier.equals(e.identifier.id, POSIT_ASSISTANT_EXTENSION_ID)) {
				return;
			}
			this._update();
		}));

		this._register(this.extensionEnablementService.onEnablementChanged(() => this._update()));
	}

	private _update(): void {
		const extension = this.extensionsWorkbenchService.local.find(e => ExtensionIdentifier.equals(e.identifier.id, POSIT_ASSISTANT_EXTENSION_ID));
		const local = extension?.local;
		const enabled = !!local && this.extensionEnablementService.isEnabled(local);
		this._positAssistantAvailable.set(enabled);
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(PositAssistantContextKeyContribution, LifecyclePhase.Restored);
