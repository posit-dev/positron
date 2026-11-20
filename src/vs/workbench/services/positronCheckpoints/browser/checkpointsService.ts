/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { Disposable, IDisposable, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ICheckpointsService } from '../common/checkpointsService.js';
import { ICheckpointsEngineProxy } from '../common/checkpointsTypes.js';

/**
 * Keeps the first registered checkpoints engine and forwards its state event.
 */
export class CheckpointsService extends Disposable implements ICheckpointsService {
	declare readonly _serviceBrand: undefined;

	private _engine: ICheckpointsEngineProxy | undefined;

	/** The subscription to the state event of the engine in use. */
	private readonly _engineListener = this._register(new MutableDisposable());

	private readonly _onDidChangeEngine = this._register(new Emitter<void>());
	readonly onDidChangeEngine = this._onDidChangeEngine.event;

	private readonly _onDidChangeState = this._register(new Emitter<void>());
	readonly onDidChangeState = this._onDidChangeState.event;

	constructor(
		@ILogService private readonly _logService: ILogService,
	) {
		super();
	}

	get hasEngine(): boolean {
		return this._engine !== undefined;
	}

	get engine(): ICheckpointsEngineProxy | undefined {
		return this._engine;
	}

	registerEngine(engine: ICheckpointsEngineProxy): IDisposable {
		if (this._engine) {
			this._logService.warn('A checkpoints engine is already registered. The new engine is ignored.');
			return toDisposable(() => { });
		}

		this._engine = engine;
		this._engineListener.value = engine.onDidChangeState(() => this._onDidChangeState.fire());
		this._onDidChangeEngine.fire();

		return toDisposable(() => {
			if (this._engine !== engine) {
				return;
			}
			this._engine = undefined;
			this._engineListener.clear();
			this._onDidChangeEngine.fire();
		});
	}
}

registerSingleton(ICheckpointsService, CheckpointsService, InstantiationType.Delayed);
