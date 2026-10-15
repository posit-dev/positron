/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { Disposable, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IErrorActionHandler, IErrorActionsService, POSIT_ASSISTANT_ERROR_ACTIONS_ID } from '../common/errorActions.js';

export class ErrorActionsService extends Disposable implements IErrorActionsService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	/** Registered handlers, by id. */
	private readonly _handlersById = new Map<string, IErrorActionHandler>();

	/** Context keys read by the registered handlers' `when` expressions. */
	private _whenKeys = new Set<string>();

	constructor(
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		this._register(this._contextKeyService.onDidChangeContext(e => {
			if (e.affectsSome(this._whenKeys)) {
				this._onDidChange.fire();
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
			if (this._handlersById.get(handler.id) === handler) {
				this._handlersById.delete(handler.id);
				this._update();
			}
		});
	}

	getHandler(): IErrorActionHandler | undefined {
		const handler = this._handlersById.get(POSIT_ASSISTANT_ERROR_ACTIONS_ID);
		return handler && (!handler.when || this._contextKeyService.contextMatchesRules(handler.when))
			? handler
			: undefined;
	}

	/** Refresh the watched context keys and notify listeners. */
	private _update(): void {
		this._whenKeys = new Set([...this._handlersById.values()].flatMap(handler => handler.when?.keys() ?? []));
		this._onDidChange.fire();
	}
}

registerSingleton(IErrorActionsService, ErrorActionsService, InstantiationType.Delayed);
