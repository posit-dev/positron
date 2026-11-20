/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePositronReactServicesContext } from '../../../../../base/browser/positronReactRendererContext.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ICheckpointsService } from '../../../../services/positronCheckpoints/common/checkpointsService.js';
import { ICheckpoint, ICheckpointsEngineProxy, IChangeSet, IEngineState } from '../../../../services/positronCheckpoints/common/checkpointsTypes.js';

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

type Snapshot = Pick<ICheckpointsViewState, 'hasEngine' | 'state' | 'changes' | 'history'>;

/**
 * Reads the state, and for a tracked project in no unusual state also the changes and the first
 * page of history. A failed call leaves its part empty and never throws.
 */
async function loadSnapshot(engine: ICheckpointsEngineProxy): Promise<Snapshot> {
	let state: IEngineState;
	try {
		state = await engine.getState();
	} catch {
		return { hasEngine: true, history: [] };
	}

	if (state.tracking !== 'tracking' || state.unusual) {
		return { hasEngine: true, state, history: [] };
	}

	const [changes, history] = await Promise.all([
		engine.getChanges().catch(() => undefined),
		engine.getHistory(0, HISTORY_PAGE_SIZE).catch((): ICheckpoint[] => []),
	]);
	return { hasEngine: true, state, changes, history };
}

/**
 * The state of the Checkpoints view. It loads when mounted and again whenever the engine changes
 * or reports a change of state. When loads overlap, only the latest one updates the view.
 */
export function useCheckpointsState(): ICheckpointsViewState {
	const services = usePositronReactServicesContext();
	const [snapshot, setSnapshot] = useState<Snapshot>({ hasEngine: false, history: [] });
	const [loading, setLoading] = useState(true);

	// Counts loads, so that a response from a superseded load is dropped.
	const latestRequest = useRef(0);

	const refresh = useCallback(() => {
		const request = ++latestRequest.current;
		const engine = services.get(ICheckpointsService).engine;
		if (!engine) {
			setSnapshot({ hasEngine: false, history: [] });
			setLoading(false);
			return;
		}

		setLoading(true);
		loadSnapshot(engine).then(loaded => {
			if (request !== latestRequest.current) {
				return;
			}
			setSnapshot(loaded);
			setLoading(false);
		});
	}, [services]);

	useEffect(() => {
		const checkpointsService = services.get(ICheckpointsService);
		// The counter itself, not a value read from it, so the cleanup increments the live count.
		const requests = latestRequest;
		const disposables = new DisposableStore();
		disposables.add(checkpointsService.onDidChangeEngine(refresh));
		disposables.add(checkpointsService.onDidChangeState(refresh));
		refresh();
		return () => {
			// Drops the response of a load that is still running.
			requests.current++;
			disposables.dispose();
		};
	}, [services, refresh]);

	return { ...snapshot, loading, refresh };
}
