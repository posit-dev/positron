/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { toErrorMessage } from '../../../../base/common/errorMessage.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { ErrorAssistantAction, IErrorAssistant, IErrorAssistantContext, IErrorAssistantInfo, IErrorAssistantOptions, IErrorAssistantService } from '../common/errorAssistant.js';
import { AI_ENABLED_KEY } from '../common/positronAIConfiguration.js';

export class ErrorAssistantService extends Disposable implements IErrorAssistantService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeActiveAssistant = this._register(new Emitter<IErrorAssistantInfo | undefined>());
	readonly onDidChangeActiveAssistant = this._onDidChangeActiveAssistant.event;

	/** Registered assistants, by id, in registration order. */
	private readonly _assistantsById = new Map<string, IErrorAssistant>();

	/** The active assistant as of the last event, to fire only on changes. */
	private _lastActiveAssistant: IErrorAssistant | undefined;

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ILogService private readonly _logService: ILogService,
		@INotificationService private readonly _notificationService: INotificationService,
	) {
		super();

		this._lastActiveAssistant = this._getActiveAssistant();
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(AI_ENABLED_KEY)) {
				this._fireIfActiveAssistantChanged();
			}
		}));
	}

	get activeAssistant(): IErrorAssistantInfo | undefined {
		return this._getActiveAssistant();
	}

	register(assistant: IErrorAssistant): IDisposable {
		if (this._assistantsById.has(assistant.id)) {
			throw new Error(`An error assistant with the id '${assistant.id}' is already registered`);
		}

		this._assistantsById.set(assistant.id, assistant);
		this._fireIfActiveAssistantChanged();
		return toDisposable(() => {
			// Nothing to update once the service itself is disposed.
			if (!this._store.isDisposed && this._assistantsById.get(assistant.id) === assistant) {
				this._assistantsById.delete(assistant.id);
				this._fireIfActiveAssistantChanged();
			}
		});
	}

	async ask(assistantId: string, action: ErrorAssistantAction, context: IErrorAssistantContext, options: IErrorAssistantOptions): Promise<void> {
		if (!this._isAIEnabled()) {
			return;
		}
		const assistant = this._assistantsById.get(assistantId);
		if (!assistant) {
			// The assistant unregistered after the user saw it named, e.g. while
			// a quick fix's dropdown was open. Its label is gone with it.
			this._logService.warn(`No error assistant with the id '${assistantId}' is registered`);
			this._notificationService.warn(
				localize('positron.errorAssistant.unavailable', "Could not send the error: the assistant is no longer available.")
			);
			return;
		}
		try {
			await assistant.ask(action, context, options);
		} catch (error) {
			this._logService.error(`Failed to send the error to ${assistant.label}`, error);
			this._notificationService.error(
				localize('positron.errorAssistant.runFailed', "Could not send the error to {0}: {1}", assistant.label, toErrorMessage(error))
			);
		}
	}

	/** Read live, since `ai.enabled` changes without a reload. */
	private _isAIEnabled(): boolean {
		return this._configurationService.getValue<boolean>(AI_ENABLED_KEY) === true;
	}

	/** The first registered assistant, while AI is enabled. */
	private _getActiveAssistant(): IErrorAssistant | undefined {
		if (!this._isAIEnabled()) {
			return undefined;
		}
		return this._assistantsById.values().next().value;
	}

	private _fireIfActiveAssistantChanged(): void {
		const activeAssistant = this._getActiveAssistant();
		if (activeAssistant !== this._lastActiveAssistant) {
			this._lastActiveAssistant = activeAssistant;
			this._onDidChangeActiveAssistant.fire(activeAssistant);
		}
	}
}

registerSingleton(IErrorAssistantService, ErrorAssistantService, InstantiationType.Delayed);
