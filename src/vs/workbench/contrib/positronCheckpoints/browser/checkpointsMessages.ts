/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const ICheckpointsMessageService = createDecorator<ICheckpointsMessageService>('positronCheckpointsMessageService');

/**
 * The one status line of the Checkpoints view. Actions publish the sentence for their result
 * here, and the view shows it inline. It is never a notification.
 */
export interface ICheckpointsMessageService {
	readonly _serviceBrand: undefined;

	/** The sentence the view shows, or undefined when the line is empty. */
	readonly message: string | undefined;

	/** Fires when `message` changes. */
	readonly onDidChangeMessage: Event<void>;

	/** Replaces the sentence. Undefined empties the line. */
	show(message: string | undefined): void;
}

export class CheckpointsMessageService extends Disposable implements ICheckpointsMessageService {
	declare readonly _serviceBrand: undefined;

	private _message: string | undefined;

	private readonly _onDidChangeMessage = this._register(new Emitter<void>());
	readonly onDidChangeMessage = this._onDidChangeMessage.event;

	get message(): string | undefined {
		return this._message;
	}

	show(message: string | undefined): void {
		if (message === this._message) {
			return;
		}
		this._message = message;
		this._onDidChangeMessage.fire();
	}
}

registerSingleton(ICheckpointsMessageService, CheckpointsMessageService, InstantiationType.Delayed);
