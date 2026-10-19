/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { toErrorMessage } from '../../../../base/common/errorMessage.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { ErrorActionKind, IErrorActionContext, IErrorActionHandler, IErrorActionsService } from '../common/errorActions.js';

export class ErrorActionsService extends Disposable implements IErrorActionsService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeActiveHandler = this._register(new Emitter<IErrorActionHandler | undefined>());
	readonly onDidChangeActiveHandler = this._onDidChangeActiveHandler.event;

	/** The active handler, as of the last registration or `when` key change. */
	private _activeHandler: IErrorActionHandler | undefined;

	/** Registered handlers, by id, in registration order. */
	private readonly _handlersById = new Map<string, IErrorActionHandler>();

	/** Context keys read by the registered handlers' `when` expressions. */
	private _whenKeys = new Set<string>();

	constructor(
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@ILogService private readonly _logService: ILogService,
		@INotificationService private readonly _notificationService: INotificationService,
	) {
		super();

		this._register(this._contextKeyService.onDidChangeContext(e => {
			if (e.affectsSome(this._whenKeys)) {
				this._updateActiveHandler();
			}
		}));
	}

	register(handler: IErrorActionHandler): IDisposable {
		if (this._handlersById.has(handler.id)) {
			this._logService.error(`An error action handler with the id '${handler.id}' is already registered`);
			return Disposable.None;
		}

		this._handlersById.set(handler.id, handler);
		this._update();
		return toDisposable(() => {
			// Nothing to update once the service itself is disposed.
			if (!this._store.isDisposed && this._handlersById.get(handler.id) === handler) {
				this._handlersById.delete(handler.id);
				this._update();
			}
		});
	}

	get activeHandler(): IErrorActionHandler | undefined {
		return this._activeHandler;
	}

	async run(handler: IErrorActionHandler, kind: ErrorActionKind, context: IErrorActionContext): Promise<void> {
		try {
			await handler.run(kind, context);
		} catch (error) {
			this._logService.error(`Failed to send the error to ${handler.label}`, error);
			this._notificationService.error(
				localize('positron.errorActions.runFailed', "Could not send the error to {0}: {1}", handler.label, toErrorMessage(error))
			);
		}
	}

	/** Refresh the watched context keys and the active handler. */
	private _update(): void {
		this._whenKeys = new Set([...this._handlersById.values()].flatMap(handler => handler.when?.keys() ?? []));
		this._updateActiveHandler();
	}

	/** Pick the first registered handler whose `when` is true, firing when it changes. */
	private _updateActiveHandler(): void {
		const activeHandler = [...this._handlersById.values()].find(handler =>
			!handler.when || this._contextKeyService.contextMatchesRules(handler.when));
		if (activeHandler !== this._activeHandler) {
			this._activeHandler = activeHandler;
			this._onDidChangeActiveHandler.fire(activeHandler);
		}
	}
}

registerSingleton(IErrorActionsService, ErrorActionsService, InstantiationType.Delayed);
