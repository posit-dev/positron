/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ICheckpointsEngineProxy } from './checkpointsTypes.js';

export const ICheckpointsService = createDecorator<ICheckpointsService>('positronCheckpointsService');

/**
 * Gives core access to the checkpoints engine that an extension registers through
 * `positron.checkpoints.registerEngine`.
 */
export interface ICheckpointsService {
	readonly _serviceBrand: undefined;

	/** True while an engine is registered. */
	readonly hasEngine: boolean;

	/** Fires when the engine in use changes: one registers, or the engine in use goes away. */
	readonly onDidChangeEngine: Event<void>;

	/**
	 * Fires when the engine in use reports that its state may differ, and when `reportStateChanged`
	 * is called.
	 */
	readonly onDidChangeState: Event<void>;

	/**
	 * Fires `onDidChangeState` for a change that the engine does not report itself, such as the
	 * removal of a recovery snapshot, so every view reads the state again.
	 */
	reportStateChanged(): void;

	/**
	 * Registers an engine. The first registered engine is used; while it is registered, each
	 * later one is ignored and a warning is logged.
	 *
	 * @returns A disposable that removes the registration.
	 */
	registerEngine(engine: ICheckpointsEngineProxy): IDisposable;

	/** The engine in use, or undefined when none is registered. */
	readonly engine: ICheckpointsEngineProxy | undefined;
}
