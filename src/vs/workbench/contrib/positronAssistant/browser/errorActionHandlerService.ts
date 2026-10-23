/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { toErrorMessage } from '../../../../base/common/errorMessage.js';
import { removeAnsiEscapeCodes } from '../../../../base/common/strings.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { ErrorAction, IErrorActionHandler, IErrorActionContext, IErrorActionHandlerInfo, IErrorActionOptions, IErrorActionHandlerService } from '../common/errorAction.js';
import { AI_ENABLED_KEY, setErrorActionHandlerChoices } from '../common/positronAIConfiguration.js';
import { DEFAULT_ERROR_ACTION_HANDLER_ID, ERROR_ACTIONS_AGENT_KEY } from '../common/positronAIConfigurationKeys.js';

export class ErrorActionHandlerService extends Disposable implements IErrorActionHandlerService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeActiveHandler = this._register(new Emitter<IErrorActionHandlerInfo | undefined>());
	readonly onDidChangeActiveHandler = this._onDidChangeActiveHandler.event;

	/** Registered handlers, by id, in registration order. */
	private readonly _handlersById = new Map<string, IErrorActionHandler>();

	/** Whether the default handler's buttons show while it's chosen. */
	private _defaultHandlerReady = false;

	/**
	 * The info naming the chosen handler while it isn't registered, kept so
	 * that {@link activeHandler} returns the same object until it changes.
	 */
	private _unavailableAssistant: IErrorActionHandlerInfo | undefined;

	/** The active handler as of the last event, to fire only on changes. */
	private _lastActiveHandler: IErrorActionHandlerInfo | undefined;

	constructor(
		@ICommandService private readonly _commandService: ICommandService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ILogService private readonly _logService: ILogService,
		@INotificationService private readonly _notificationService: INotificationService,
	) {
		super();

		// The choices are global, so put them back when this service goes.
		this._register(toDisposable(() => setErrorActionHandlerChoices([])));
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(AI_ENABLED_KEY) || e.affectsConfiguration(ERROR_ACTIONS_AGENT_KEY)) {
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
		this._updateChoices();
		this._fireIfActiveHandlerChanged();
		return toDisposable(() => {
			// Nothing to update once the service itself is disposed.
			if (!this._store.isDisposed) {
				this._handlersById.delete(handler.id);
				// The setting keeps its value, which the Settings editor flags
				// as no longer one of the choices.
				this._updateChoices();
				this._fireIfActiveHandlerChanged();
			}
		});
	}

	setDefaultAssistantReady(ready: boolean): void {
		this._defaultHandlerReady = ready;
		this._fireIfActiveHandlerChanged();
	}

	async ask(handlerId: string, action: ErrorAction, context: IErrorActionContext, options: IErrorActionOptions): Promise<void> {
		if (!this._isAIEnabled()) {
			return;
		}
		const handler = this._handlersById.get(handlerId);
		if (!handler) {
			// The chosen handler was uninstalled or disabled, so its label
			// is gone with it. Name it by its id.
			this._logService.warn(`No error action handler with the id '${handlerId}' is registered`);
			this._notificationService.prompt(
				Severity.Warning,
				localize('positron.errorAction.unavailable', "The coding agent '{0}' isn't available, so the error wasn't sent. It may have been uninstalled or disabled.", handlerId),
				[{
					label: localize('positron.errorAction.selectAnother', "Select Another Coding Agent"),
					run: () => this._commandService.executeCommand('workbench.action.openSettings', `@id:${ERROR_ACTIONS_AGENT_KEY}`),
				}],
			);
			return;
		}
		if (handler.id === DEFAULT_ERROR_ACTION_HANDLER_ID && !this._defaultHandlerReady) {
			// It stopped being ready between render and click, and its buttons
			// are about to hide.
			this._logService.warn(`The default error action handler '${handler.id}' is not ready to take errors`);
			this._notificationService.warn(
				localize('positron.errorAction.notReady', "{0} isn't available, so the error wasn't sent.", handler.label)
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

	/** The id of the chosen handler, read live. */
	private _getChosenHandlerId(): string {
		const id = this._configurationService.getValue<unknown>(ERROR_ACTIONS_AGENT_KEY);
		return typeof id === 'string' && id ? id : DEFAULT_ERROR_ACTION_HANDLER_ID;
	}

	/** The chosen handler, while AI is enabled and, for the default, it's ready. */
	private _getActiveHandler(): IErrorActionHandlerInfo | undefined {
		if (!this._isAIEnabled()) {
			return undefined;
		}
		const id = this._getChosenHandlerId();
		const handler = this._handlersById.get(id);
		if (id === DEFAULT_ERROR_ACTION_HANDLER_ID) {
			// The default handler is chosen for all users, even those who have
			// never configured AI providers. Don't return a handler in that
			// case, so we don't show the buttons.
			return this._defaultHandlerReady ? handler : undefined;
		}
		if (handler) {
			return handler;
		}
		if (this._unavailableAssistant?.id !== id) {
			// A previously chosen handler is no longer available. Return an
			// abbreviated version until it becomes available, and cache it
			// for equality checks before we emit onDidChangeActiveHandler.
			this._unavailableAssistant = { id, label: id, supportsChatContinuation: false };
		}
		return this._unavailableAssistant;
	}

	/** List the registered handlers in the setting. */
	private _updateChoices(): void {
		setErrorActionHandlerChoices([...this._handlersById.values()]);
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
