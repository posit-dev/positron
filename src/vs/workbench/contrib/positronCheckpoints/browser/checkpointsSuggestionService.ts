/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IChangeSet } from '../../../services/positronCheckpoints/common/checkpointsTypes.js';
import { IProposedChunk } from '../common/agent/splitIntoChunks.js';

export const ICheckpointsSuggestionService = createDecorator<ICheckpointsSuggestionService>('positronCheckpointsSuggestionService');

/** A suggestion to record the unrecorded changes as checkpoints (spec 7.1). */
export interface ISuggestion {
	/** The changes the chunks were computed from. */
	changes: IChangeSet;
	/** The proposed checkpoints. At least one of them looks finished. */
	chunks: IProposedChunk[];
}

/**
 * Holds the open checkpoint suggestion, so the suggestion card and the activity bar badge read the
 * same one. At most one suggestion is open at a time.
 */
export interface ICheckpointsSuggestionService {
	readonly _serviceBrand: undefined;

	/** The open suggestion, or undefined when there is none. */
	readonly current: ISuggestion | undefined;

	/** Fires when `current` changes. */
	readonly onDidChange: Event<void>;

	/** Fires when the person dismisses the open suggestion. */
	readonly onDidDismiss: Event<void>;

	/** Opens a suggestion, replacing the open one. */
	publish(suggestion: ISuggestion): void;

	/** Closes the open suggestion because the person dismissed it. */
	dismiss(): void;

	/** Closes the open suggestion because it no longer applies. */
	clear(): void;
}

export class CheckpointsSuggestionService extends Disposable implements ICheckpointsSuggestionService {
	declare readonly _serviceBrand: undefined;

	private _current: ISuggestion | undefined;

	private readonly _onDidChange = this._register(new Emitter<void>());
	readonly onDidChange = this._onDidChange.event;

	private readonly _onDidDismiss = this._register(new Emitter<void>());
	readonly onDidDismiss = this._onDidDismiss.event;

	get current(): ISuggestion | undefined {
		return this._current;
	}

	publish(suggestion: ISuggestion): void {
		this._current = suggestion;
		this._onDidChange.fire();
	}

	dismiss(): void {
		if (!this._current) {
			return;
		}
		this.clear();
		this._onDidDismiss.fire();
	}

	clear(): void {
		if (!this._current) {
			return;
		}
		this._current = undefined;
		this._onDidChange.fire();
	}
}

registerSingleton(ICheckpointsSuggestionService, CheckpointsSuggestionService, InstantiationType.Delayed);
