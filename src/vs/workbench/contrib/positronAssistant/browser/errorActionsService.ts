/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { Disposable, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IErrorActionHandler, IErrorActionsService, POSIT_ASSISTANT_ERROR_ACTIONS_ID } from '../common/errorActions.js';

export class ErrorActionsService extends Disposable implements IErrorActionsService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	/** Registered handlers, by id. */
	private readonly _handlersById = new Map<string, IErrorActionHandler>();

	constructor(
		@ILogService private readonly _logService: ILogService,
	) {
		super();
	}

	register(handler: IErrorActionHandler): IDisposable {
		if (this._handlersById.has(handler.id)) {
			this._logService.error(`An error action handler with the id '${handler.id}' is already registered`);
			return Disposable.None;
		}

		this._handlersById.set(handler.id, handler);
		this._onDidChange.fire();
		return toDisposable(() => {
			if (this._handlersById.get(handler.id) === handler) {
				this._handlersById.delete(handler.id);
				this._onDidChange.fire();
			}
		});
	}

	getHandler(): IErrorActionHandler | undefined {
		return this._handlersById.get(POSIT_ASSISTANT_ERROR_ACTIONS_ID);
	}
}

registerSingleton(IErrorActionsService, ErrorActionsService, InstantiationType.Delayed);
