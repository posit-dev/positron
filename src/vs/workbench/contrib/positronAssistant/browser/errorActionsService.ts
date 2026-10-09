/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { toErrorMessage } from '../../../../base/common/errorMessage.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { ErrorActionKind, IErrorActionContext, IErrorActionHandler, IErrorActionHandlerRegistration, IErrorActionsService, IRegisteredErrorActionHandler, POSIT_ASSISTANT_ERROR_ACTIONS_ID } from '../common/errorActions.js';

/** Name of Posit Assistant's implementation. */
export const POSIT_ASSISTANT_ERROR_ACTIONS_LABEL = localize('positron.errorActions.agent.positAssistant', "Posit Assistant");

/**
 * Storage key of the selected implementation. Profile-scoped so the choice
 * follows the user across workspaces, and synced across machines.
 */
const SELECTED_ID_STORAGE_KEY = 'positron.errorActions.selectedAgent';

/** A registered implementation, with its state. */
interface IRegisteredHandler {
	readonly handler: IErrorActionHandler;
	canContinueChat: boolean;
	problem: string | undefined;
}

export class ErrorActionsService extends Disposable implements IErrorActionsService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	/** Registered implementations, in registration order. */
	private readonly _registered: IRegisteredHandler[] = [];

	/** Context keys read by the registered implementations' `when` expressions. */
	private _whenKeys = new Set<string>();

	constructor(
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@ILogService private readonly _logService: ILogService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IStorageService private readonly _storageService: IStorageService,
	) {
		super();

		// Fires for this window's selections, other windows', and ones Settings
		// Sync brings from other machines.
		this._register(this._storageService.onDidChangeValue(StorageScope.PROFILE, SELECTED_ID_STORAGE_KEY, this._store)(() => {
			this._onDidChange.fire();
		}));

		// Handlers' `when` expressions can change which one errors go to.
		this._register(this._contextKeyService.onDidChangeContext(e => {
			if (this._whenKeys.size > 0 && e.affectsSome(this._whenKeys)) {
				this._onDidChange.fire();
			}
		}));
	}

	register(handler: IErrorActionHandler): IErrorActionHandlerRegistration {
		if (this._registered.some(registered => registered.handler.id === handler.id)) {
			this._logService.error(`An error action handler with the id '${handler.id}' is already registered`);
			return { setCanContinueChat: () => { }, setProblem: () => { }, dispose: () => { } };
		}

		const registered: IRegisteredHandler = { handler, canContinueChat: true, problem: undefined };
		this._registered.push(registered);
		this._update();
		return {
			setCanContinueChat: canContinueChat => {
				if (canContinueChat !== registered.canContinueChat) {
					registered.canContinueChat = canContinueChat;
					this._onDidChange.fire();
				}
			},
			setProblem: problem => {
				if (problem !== registered.problem) {
					registered.problem = problem;
					this._onDidChange.fire();
				}
			},
			dispose: () => {
				const index = this._registered.indexOf(registered);
				if (index !== -1) {
					this._registered.splice(index, 1);
					this._update();
				}
			},
		};
	}

	getRegistered(): readonly IRegisteredErrorActionHandler[] {
		const isPositAssistant = (registered: IRegisteredHandler) => registered.handler.id === POSIT_ASSISTANT_ERROR_ACTIONS_ID;
		return [...this._registered.filter(isPositAssistant), ...this._registered.filter(registered => !isPositAssistant(registered))]
			.map(({ handler, problem }) => ({ handler, problem, isEnabled: this._isEnabled(handler) }));
	}

	get selectedId(): string {
		return this._storageService.get(SELECTED_ID_STORAGE_KEY, StorageScope.PROFILE, POSIT_ASSISTANT_ERROR_ACTIONS_ID);
	}

	select(id: string): void {
		this._storageService.store(SELECTED_ID_STORAGE_KEY, id, StorageScope.PROFILE, StorageTarget.USER);
	}

	getConfigured(): IErrorActionHandler | undefined {
		const enabled = this._registered
			.map(registered => registered.handler)
			.filter(handler => this._isEnabled(handler));
		return enabled.find(handler => handler.id === this.selectedId)
			?? enabled.find(handler => handler.id === POSIT_ASSISTANT_ERROR_ACTIONS_ID);
	}

	canContinueChat(handler: IErrorActionHandler): boolean {
		return this._registered.find(registered => registered.handler === handler)?.canContinueChat ?? true;
	}

	async run(handler: IErrorActionHandler, kind: ErrorActionKind, context: IErrorActionContext): Promise<void> {
		try {
			await handler.run(kind, context, CancellationToken.None);
		} catch (error) {
			this._logService.error(`Failed to send the error to ${handler.label}`, error);
			this._notificationService.error(
				localize(
					'positron.errorActions.runFailed',
					"Could not send the error to {0}: {1}",
					handler.label,
					toErrorMessage(error)
				)
			);
		}
	}

	/** Whether a handler's `when` holds. */
	private _isEnabled(handler: IErrorActionHandler): boolean {
		return !handler.when || this._contextKeyService.contextMatchesRules(handler.when);
	}

	/** Refresh the watched context keys, and notify listeners. */
	private _update(): void {
		this._whenKeys = new Set(this._registered.flatMap(registered => registered.handler.when?.keys() ?? []));
		this._onDidChange.fire();
	}
}

registerSingleton(IErrorActionsService, ErrorActionsService, InstantiationType.Delayed);
