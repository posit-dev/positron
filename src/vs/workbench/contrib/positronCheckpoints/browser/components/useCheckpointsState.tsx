/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { RunOnceScheduler } from '../../../../../base/common/async.js';
import { DisposableStore, IDisposable } from '../../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { ICheckpointsService } from '../../../../services/positronCheckpoints/common/checkpointsService.js';
import { ICheckpoint, ICheckpointsEngineProxy, IChangeSet, IEngineState } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { ICheckpointsMessageService, reportReadFailure } from '../checkpointsMessages.js';

/** The number of checkpoints in the first page of history. */
export const HISTORY_PAGE_SIZE = 50;

/** What the view knows about the project. */
export interface ICheckpointsViewState {
	/** True while an engine is registered. */
	hasEngine: boolean;
	/** Undefined before the first load, without an engine, or when the engine could not report it. */
	state?: IEngineState;
	/** Loaded only for a tracked project in no unusual state. */
	changes?: IChangeSet;
	/** The first page of history, loaded with `changes`. */
	history: ICheckpoint[];
	/** True while a load runs. The values of the previous load stay in place meanwhile. */
	loading: boolean;
	/** Loads everything again. */
	refresh(): void;
}

type Snapshot = Pick<ICheckpointsViewState, 'hasEngine' | 'state' | 'changes' | 'history'> & {
	/** The errors of the reads that failed, each with what was being read. Empty when every read worked. */
	failures: { what: string; error: unknown }[];
};

/**
 * Reads the state, and for a tracked project in no unusual state also the changes and the first
 * page of history. A failed call leaves its part empty, is listed in `failures`, and never throws.
 */
async function loadSnapshot(engine: ICheckpointsEngineProxy): Promise<Snapshot> {
	let state: IEngineState;
	try {
		state = await engine.getState();
	} catch (error) {
		return { hasEngine: true, history: [], failures: [{ what: 'The state of the project could not be read.', error }] };
	}

	if (state.tracking !== 'tracking' || state.unusual) {
		return { hasEngine: true, state, history: [], failures: [] };
	}

	const failures: Snapshot['failures'] = [];
	const [changes, history] = await Promise.all([
		engine.getChanges().catch(error => {
			failures.push({ what: 'The changes of the project could not be read.', error });
			return undefined;
		}),
		engine.getHistory(0, HISTORY_PAGE_SIZE).catch((error): ICheckpoint[] => {
			failures.push({ what: 'The history of the project could not be read.', error });
			return [];
		}),
	]);
	return { hasEngine: true, state, changes, history, failures };
}

/** How long state change events are gathered before they start one load. */
export const STATE_CHANGE_DELAY_MS = 300;

/**
 * Runs loads one at a time. A request while a load runs queues one more load, however many
 * requests arrive, and the result of the running load is dropped, because the queued load reads
 * newer values. `requestSoon` gathers the requests of `delayMs` into one. After disposal nothing
 * runs and no result is applied.
 */
export class CoalescingLoader<T> implements IDisposable {
	private _running = false;
	private _queued = false;
	private _disposed = false;
	private readonly _soon: RunOnceScheduler;

	constructor(
		private readonly _load: () => Promise<T>,
		private readonly _apply: (value: T) => void,
		delayMs: number,
	) {
		this._soon = new RunOnceScheduler(() => this.request(), delayMs);
	}

	/** Starts a load now, or queues one while a load runs. */
	request(): void {
		if (this._disposed) {
			return;
		}
		if (this._running) {
			this._queued = true;
			return;
		}
		void this._run();
	}

	/** Starts a load after `delayMs`, together with every other request in that time. */
	requestSoon(): void {
		if (!this._disposed && !this._soon.isScheduled()) {
			this._soon.schedule();
		}
	}

	dispose(): void {
		this._disposed = true;
		this._soon.dispose();
	}

	private async _run(): Promise<void> {
		this._running = true;
		let value: T;
		try {
			value = await this._load();
		} finally {
			this._running = false;
		}
		if (this._disposed) {
			return;
		}
		if (this._queued) {
			this._queued = false;
			void this._run();
			return;
		}
		this._apply(value);
	}
}

/**
 * The state of the Checkpoints view. It loads when mounted and again whenever the engine changes
 * or reports a change of state. At most one load runs at a time, with at most one more queued, and
 * the state change events of `STATE_CHANGE_DELAY_MS` start one load.
 *
 * A read that fails is logged, and the could-not-load sentence shows on the status line of the
 * view. A later load in which every read works empties the line, if it still shows that sentence.
 */
export function useCheckpointsState(): ICheckpointsViewState {
	const services = usePositronReactServicesContext();
	const [snapshot, setSnapshot] = useState<Omit<Snapshot, 'failures'>>({ hasEngine: false, history: [] });
	const [loading, setLoading] = useState(true);

	// The loader of the mounted view, which `refresh` asks for a load.
	const loader = useRef<CoalescingLoader<Snapshot>>(undefined);

	const refresh = useCallback(() => loader.current?.request(), []);

	useEffect(() => {
		const checkpointsService = services.get(ICheckpointsService);
		const messageService = services.get(ICheckpointsMessageService);
		const logService = services.get(ILogService);
		// The could-not-load sentence this view showed last, so a clean load can take it away.
		let shownFailure: string | undefined;
		const disposables = new DisposableStore();
		const current = disposables.add(new CoalescingLoader<Snapshot>(
			async () => {
				const engine = checkpointsService.engine;
				if (!engine) {
					return { hasEngine: false, history: [], failures: [] };
				}
				setLoading(true);
				return loadSnapshot(engine);
			},
			({ failures, ...loaded }) => {
				for (const { what, error } of failures) {
					shownFailure = reportReadFailure(logService, messageService, what, error);
				}
				if (failures.length === 0 && shownFailure !== undefined && messageService.message === shownFailure) {
					messageService.show(undefined);
				}
				if (failures.length === 0) {
					shownFailure = undefined;
				}
				setSnapshot(loaded);
				setLoading(false);
			},
			STATE_CHANGE_DELAY_MS,
		));
		loader.current = current;
		disposables.add(checkpointsService.onDidChangeEngine(() => current.request()));
		disposables.add(checkpointsService.onDidChangeState(() => current.requestSoon()));
		current.request();
		return () => {
			if (loader.current === current) {
				loader.current = undefined;
			}
			disposables.dispose();
		};
	}, [services]);

	return { ...snapshot, loading, refresh };
}
