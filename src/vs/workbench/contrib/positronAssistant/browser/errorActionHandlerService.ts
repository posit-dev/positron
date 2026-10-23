/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { toErrorMessage } from '../../../../base/common/errorMessage.js';
import { removeAnsiEscapeCodes } from '../../../../base/common/strings.js';
import { Emitter } from '../../../../base/common/event.js';
import { Iterable } from '../../../../base/common/iterator.js';
import { Disposable, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { ErrorAction, IErrorActionHandler, IErrorActionContext, IErrorActionHandlerInfo, IErrorActionOptions, IErrorActionHandlerService } from '../common/errorAction.js';
import { AI_ENABLED_KEY } from '../common/positronAIConfiguration.js';

export class ErrorActionHandlerService extends Disposable implements IErrorActionHandlerService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeActiveHandler = this._register(new Emitter<IErrorActionHandlerInfo | undefined>());
	readonly onDidChangeActiveHandler = this._onDidChangeActiveHandler.event;

	/** Registered handlers, by id, in registration order. */
	private readonly _handlersById = new Map<string, IErrorActionHandler>();

	/** The active handler as of the last event, to fire only on changes. */
	private _lastActiveHandler: IErrorActionHandler | undefined;

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ILogService private readonly _logService: ILogService,
		@INotificationService private readonly _notificationService: INotificationService,
	) {
		super();

		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(AI_ENABLED_KEY)) {
				this._fireIfActiveHandlerChanged();
			}
		}));
	}

	get activeHandler(): IErrorActionHandlerInfo | undefined {
		return this._getActiveHandler();
	}

	register(handler: IErrorActionHandler): IDisposable {
		if (this._handlersById.has(handler.id)) {
			throw new Error(`An error action handler with the id '${handler.id}' is already registered`);
		}

		this._handlersById.set(handler.id, handler);
		this._fireIfActiveHandlerChanged();
		return toDisposable(() => {
			// Nothing to update once the service itself is disposed.
			if (!this._store.isDisposed) {
				this._handlersById.delete(handler.id);
				this._fireIfActiveHandlerChanged();
			}
		});
	}

	async ask(handlerId: string, action: ErrorAction, context: IErrorActionContext, options: IErrorActionOptions): Promise<void> {
		if (!this._isAIEnabled()) {
			return;
		}
		const handler = this._handlersById.get(handlerId);
		if (!handler) {
			// The handler unregistered after the user saw it named, e.g. while
			// a quick fix's dropdown was open. Its label is gone with it.
			this._logService.warn(`No error action handler with the id '${handlerId}' is registered`);
			this._notificationService.warn(
				localize('positron.errorAction.unavailable', "Could not send the error: the coding agent is no longer available.")
			);
			return;
		}
		// Hold every handler to the contract here, rather than in each surface.
		const plainContext = { ...context, error: removeAnsiEscapeCodes(context.error) };
		const supportedOptions = { ...options, continueChat: handler.supportsChatContinuation && options.continueChat };
		try {
			await handler.ask(action, plainContext, supportedOptions);
		} catch (error) {
			this._logService.error(`Failed to send the error to ${handler.label}`, error);
			this._notificationService.error(
				localize('positron.errorAction.askFailed', "Could not send the error to {0}: {1}", handler.label, toErrorMessage(error))
			);
		}
	}

	/** Read live, since `ai.enabled` changes without a reload. */
	private _isAIEnabled(): boolean {
		return this._configurationService.getValue<boolean>(AI_ENABLED_KEY) === true;
	}

	/** The first registered handler, while AI is enabled. */
	private _getActiveHandler(): IErrorActionHandler | undefined {
		if (!this._isAIEnabled()) {
			return undefined;
		}
		return Iterable.first(this._handlersById.values());
	}

	private _fireIfActiveHandlerChanged(): void {
		const activeHandler = this._getActiveHandler();
		if (activeHandler !== this._lastActiveHandler) {
			this._lastActiveHandler = activeHandler;
			this._onDidChangeActiveHandler.fire(activeHandler);
		}
	}
}

registerSingleton(IErrorActionHandlerService, ErrorActionHandlerService, InstantiationType.Delayed);
