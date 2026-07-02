/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ActivityItem, TrimScrollbackResult } from './activityItem.js';
import { Emitter } from '../../../../../base/common/event.js';
import { formatOutputLinesForClipboard } from '../utils/clipboardUtils.js';
import { ANSIOutput, ANSIOutputLine } from '../../../../../base/common/ansiOutput.js';

/**
 * ActivityItemInputState enumeration.
 */
export const enum ActivityItemInputState {
	Provisional = 'provisional',
	Executing = 'executing',
	Completed = 'completed',
	Cancelled = 'cancelled'
}

/**
 * ActivityItemInput class.
 */
export class ActivityItemInput extends ActivityItem {
	//#region Private Properties

	/**
	 * Gets or sets the state.
	 */
	private _state: ActivityItemInputState;

	/**
	 * Gets the code output lines.
	 */
	private _codeOutputLines: ANSIOutputLine[] = [];

	/**
	 * onStateChanged event emitter.
	 */
	private readonly _onStateChangedEmitter = new Emitter<void>();

	//#endregion Private Properties

	//#region Public Properties

	/**
	 * Gets the state.
	 */
	get state() {
		return this._state;
	}

	/**
	 * Sets the state.
	 * @param state The state to set.
	 */
	set state(state: ActivityItemInputState) {
		if (state !== this._state) {
			this._state = state;
			this._onStateChangedEmitter.fire();
		}
	}

	/**
	 * Gets the code output lines.
	 */
	get codeOutputLines(): readonly ANSIOutputLine[] {
		return this._codeOutputLines;
	}

	//#endregion Public Properties

	//#region Public Events

	/**
	 * An event that fires when the state changes.
	 */
	public onStateChanged = this._onStateChangedEmitter.event;

	//#region Public Events

	//#region Constructor

	/**
	 * Constructor.
	 * @param id The identifier.
	 * @param parentId The parent identifier.
	 * @param when The date.
	 * @param state The initial state.
	 * @param inputPrompt The input prompt.
	 * @param continuationPrompt The continuation prompt.
	 * @param code The code.
	 * @param attributionLabel The provenance label shown next to the input
	 * (e.g. "Claude Code"), if the code was executed by an external agent.
	 * Mutable so the label survives when the runtime's input rebroadcast
	 * replaces this item (see RuntimeItemActivity.addActivityItem).
	 */
	constructor(
		id: string,
		parentId: string,
		when: Date,
		state: ActivityItemInputState,
		readonly inputPrompt: string,
		readonly continuationPrompt: string,
		readonly code: string,
		public attributionLabel?: string
	) {
		// Call the base class's constructor.
		super(id, parentId, when);

		// Initialize.
		this._state = state;
		this._codeOutputLines = ANSIOutput.processOutput(code);
	}

	//#endregion Constructor

	//#region Public Methods

	/**
	 * Trim scrollback.
	 * @param scrollbackSize A number representing the scrollback size.
	 * @returns A TrimScrollbackResult indicating the result of the trim scrollback operation.
	 */
	public override trimScrollback(scrollbackSize: number): TrimScrollbackResult {
		// We should never be called with a scrollback size <= 0.
		if (scrollbackSize <= 0) {
			return {
				trimmed: false,
				remainingScrollbackSize: 0
			};
		}

		// Counts as one scrollback item; nothing is trimmed in place.
		return {
			trimmed: false,
			remainingScrollbackSize: scrollbackSize - 1
		};
	}

	/**
	 * Gets the clipboard representation of the activity item.
	 * @param commentPrefix The comment prefix to use.
	 * @returns The clipboard representation of the activity item.
	 */
	public override getClipboardRepresentation(commentPrefix: string): string[] {
		// Activity item inputs are not commented out, so ignore the comment prefix.
		return formatOutputLinesForClipboard(this._codeOutputLines);
	}

	//#endregion Public Methods
}
