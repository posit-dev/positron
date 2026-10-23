/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { raceTimeout } from '../../../../base/common/async.js';
import { toErrorMessage } from '../../../../base/common/errorMessage.js';
import { removeAnsiEscapeCodes } from '../../../../base/common/strings.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IExtensionService } from '../../../services/extensions/common/extensions.js';
import { IPreferencesService } from '../../../services/preferences/common/preferences.js';
import { openSettingWhereSet } from '../../../services/preferences/common/positronSettingsUtils.js';
import { ErrorAction, IErrorActionHandler, IErrorActionContext, IErrorActionHandlerInfo, IErrorActionOptions, IErrorActionHandlerService } from '../common/errorAction.js';
import { AI_ENABLED_KEY, DEFAULT_ERROR_ACTION_HANDLER_LABEL, setErrorActionHandlerChoices } from '../common/positronAIConfiguration.js';
import { DEFAULT_ERROR_ACTION_HANDLER_ID, ERROR_ACTIONS_AGENT_KEY } from '../common/positronAIConfigurationKeys.js';
import { getErrorActionHandlerActivationEvent, getErrorActionHandlerContributions, IErrorActionHandlerContribution } from './errorActionHandlersExtensionPoint.js';

/**
 * How long a click waits for a contributed handler's extension to activate and
 * register it before saying it isn't available.
 */
const ACTIVATION_TIMEOUT = 5_000;

export class ErrorActionHandlerService extends Disposable implements IErrorActionHandlerService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeActiveHandler = this._register(new Emitter<IErrorActionHandlerInfo | undefined>());
	readonly onDidChangeActiveHandler = this._onDidChangeActiveHandler.event;

	/** Registered handlers, by id, in registration order. */
	private readonly _handlersById = new Map<string, IErrorActionHandler>();

	/**
	 * The active handler, kept so that reads between changes return the same
	 * object.
	 */
	private _activeHandler: IErrorActionHandlerInfo | undefined;

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IExtensionService private readonly _extensionService: IExtensionService,
		@ILogService private readonly _logService: ILogService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IPreferencesService private readonly _preferencesService: IPreferencesService,
	) {
		super();

		this._activeHandler = this._getActiveHandler();
		this._updateChoices();
		// The choices are global, so put them back when this service goes.
		this._register(toDisposable(() => setErrorActionHandlerChoices([])));
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(ERROR_ACTIONS_AGENT_KEY)) {
				this._updateChoices();
			}
			if (e.affectsConfiguration(AI_ENABLED_KEY) || e.affectsConfiguration(ERROR_ACTIONS_AGENT_KEY)) {
				this._updateActiveHandler();
			}
		}));
		// Contributions name a chosen handler before it registers.
		this._register(this._extensionService.onDidChangeExtensions(() => {
			this._updateChoices();
			this._updateActiveHandler();
		}));
	}

	get activeHandler(): IErrorActionHandlerInfo | undefined {
		return this._activeHandler;
	}

	register(handler: IErrorActionHandler): IDisposable {
		if (this._handlersById.has(handler.id)) {
			throw new Error(`An error action handler with the id '${handler.id}' is already registered`);
		}

		this._handlersById.set(handler.id, handler);
		this._updateChoices();
		this._updateActiveHandler();
		return toDisposable(() => {
			// Nothing to update once the service itself is disposed.
			if (!this._store.isDisposed) {
				this._handlersById.delete(handler.id);
				// The setting keeps its value, listed as not available.
				this._updateChoices();
				this._updateActiveHandler();
			}
		});
	}

	async ask(handlerId: string, action: ErrorAction, context: IErrorActionContext, options: IErrorActionOptions): Promise<void> {
		if (!this._isAIEnabled()) {
			return;
		}
		const handler = this._handlersById.get(handlerId) ?? await this._activateHandler(handlerId);
		if (!this._isAIEnabled()) {
			return;
		}
		if (!handler) {
			this._logService.warn(`No error action handler with the id '${handlerId}' is registered`);
			// Contributed by an installed extension, but not registered, e.g.
			// because the coding agent itself isn't installed.
			const name = this._getContribution(handlerId)?.label ?? handlerId;
			if (handlerId === DEFAULT_ERROR_ACTION_HANDLER_ID) {
				// It unregistered between render and click, and its buttons are
				// about to hide.
				this._notificationService.warn(
					localize('positron.errorAction.notReady', "{0} isn't available, so the error wasn't sent.", DEFAULT_ERROR_ACTION_HANDLER_LABEL)
				);
			} else if (this._configurationService.inspect(ERROR_ACTIONS_AGENT_KEY).policyValue !== undefined) {
				// The user can't choose another one, so don't offer to.
				this._notificationService.warn(
					localize('positron.errorAction.unavailableManaged', "The coding agent '{0}' isn't available, so the error wasn't sent. Your administrator manages which coding agent errors are sent to.", name)
				);
			} else {
				// When the chosen handler's extension was uninstalled or
				// disabled, its label is gone with it, so it's named by its id.
				this._notificationService.prompt(
					Severity.Warning,
					localize('positron.errorAction.unavailable', "The coding agent '{0}' isn't available, so the error wasn't sent. It may have been uninstalled or disabled.", name),
					[{
						label: localize('positron.errorAction.selectAnother', "Select Another Coding Agent"),
						run: () => openSettingWhereSet(this._preferencesService, this._configurationService, ERROR_ACTIONS_AGENT_KEY),
					}],
				);
			}
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

	/**
	 * Activate the extension that contributes a handler that hasn't registered,
	 * e.g. on a click soon after startup, and wait for it to register.
	 * @returns The handler, or undefined when no installed extension
	 *   contributes it or it didn't register in time.
	 */
	private async _activateHandler(id: string): Promise<IErrorActionHandler | undefined> {
		if (id === DEFAULT_ERROR_ACTION_HANDLER_ID) {
			// It registers only while it can take errors, so don't wait for it.
			return undefined;
		}
		await this._extensionService.whenInstalledExtensionsRegistered();
		if (!this._getContribution(id)) {
			return undefined;
		}
		// The extension registers the handler, if it can, before it finishes
		// activating.
		await raceTimeout(this._extensionService.activateByEvent(getErrorActionHandlerActivationEvent(id)), ACTIVATION_TIMEOUT);
		return this._handlersById.get(id);
	}

	/** The contribution of a handler by an installed, enabled extension. */
	private _getContribution(id: string): IErrorActionHandlerContribution | undefined {
		for (const extension of this._extensionService.extensions) {
			const contribution = getErrorActionHandlerContributions(extension).find(contribution => contribution.id === id);
			if (contribution) {
				return contribution;
			}
		}
		return undefined;
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

	/** The chosen handler, while AI is enabled and, for the default, it's registered. */
	private _getActiveHandler(): IErrorActionHandlerInfo | undefined {
		if (!this._isAIEnabled()) {
			return undefined;
		}
		const id = this._getChosenHandlerId();
		const handler = this._handlersById.get(id);
		if (handler) {
			return handler;
		}
		if (id === DEFAULT_ERROR_ACTION_HANDLER_ID) {
			// The default handler is chosen for all users, even those who have
			// never configured AI providers, so don't show its buttons until it
			// registers.
			return undefined;
		}
		// The chosen handler isn't registered. Name it as its extension
		// contributes it, or by its id when no extension does.
		return { id, label: this._getContribution(id)?.label ?? id, supportsChatContinuation: false };
	}

	/**
	 * List the registered handlers in the setting, and the chosen one if it
	 * isn't registered, so the Settings editor shows it rather than the first
	 * choice.
	 */
	private _updateChoices(): void {
		const choices: { id: string; label: string }[] = [...this._handlersById.values()];
		const chosenId = this._getChosenHandlerId();
		if (chosenId !== DEFAULT_ERROR_ACTION_HANDLER_ID && !this._handlersById.has(chosenId)) {
			const name = this._getContribution(chosenId)?.label ?? chosenId;
			choices.push({ id: chosenId, label: localize('positron.errorAction.unavailableChoice', "{0} (not available)", name) });
		}
		setErrorActionHandlerChoices(choices);
	}

	private _updateActiveHandler(): void {
		// Compare what surfaces show, since an unregistered handler's info is
		// built afresh.
		const activeHandler = this._getActiveHandler();
		const last = this._activeHandler;
		if (activeHandler?.id !== last?.id
			|| activeHandler?.label !== last?.label
			|| activeHandler?.supportsChatContinuation !== last?.supportsChatContinuation) {
			this._activeHandler = activeHandler;
			this._onDidChangeActiveHandler.fire(activeHandler);
		}
	}
}

registerSingleton(IErrorActionHandlerService, ErrorActionHandlerService, InstantiationType.Delayed);
