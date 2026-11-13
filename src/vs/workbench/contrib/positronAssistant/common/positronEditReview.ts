/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { IDisposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const IPositronEditReviewService = createDecorator<IPositronEditReviewService>('positronEditReviewService');

/** Shows file edits made by an agent in the editor, for the user to keep or undo. */
export interface IPositronEditReviewService {
	readonly _serviceBrand: undefined;

	/**
	 * Create an edit review session.
	 * @throws When `ai.enabled` is off.
	 */
	createSession(): IPositronEditReviewSession;
}

/** A file edited in a session: whether its edits await review, or how the user last settled them. */
export interface IPositronEditReviewEntry {
	readonly uri: URI;
	readonly state: 'pending' | 'kept' | 'undone';
	/** While edits are pending, the file's text with the changes kept so far and none of the pending ones. */
	readonly baseline?: string;
}

/**
 * A set of file edits under review. Disposing it ends any edits still in
 * progress and keeps the edits still pending.
 */
export interface IPositronEditReviewSession extends IDisposable {
	/**
	 * Begin a group of edits made directly on disk. Changes to `resources`
	 * until the matching {@link stopEdits} become pending edits.
	 * @returns The id to end the group with.
	 */
	startEdits(resources: readonly URI[]): Promise<number>;

	/** End a group of edits begun with {@link startEdits}. */
	stopEdits(operationId: number): Promise<void>;

	/** Fires with the files edited in this session when one is edited, or any of its changes are kept or undone. */
	readonly onDidChangeEntries: Event<readonly IPositronEditReviewEntry[]>;

	/** Keep the pending edits to `resources`, or to every file when omitted. */
	keep(resources?: readonly URI[]): Promise<void>;

	/** Undo the pending edits to `resources`, or to every file when omitted. */
	undo(resources?: readonly URI[]): Promise<void>;

	/** Open a diff of every file edited in this session. */
	show(): Promise<void>;
}
