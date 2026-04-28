/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../../base/common/event.js';
import { ActivityItem, TrimScrollbackResult } from './activityItem.js';
import { formatOutputLinesForClipboard } from '../utils/clipboardUtils.js';
import { ANSIOutput, ANSIOutputLine } from '../../../../../base/common/ansiOutput.js';

/**
 * ActivityItemPromptState enumeration.
 */
export const enum ActivityItemPromptState {
	Unanswered = 'Unanswered',
	Answered = 'Answered',
	Interrupted = 'Interrupted'
}

/**
 * ActivityItemPrompt class.
 */
export class ActivityItemPrompt extends ActivityItem {
	//#region Private Properties

	/**
	 * The state of the prompt.
	 */
	private _state = ActivityItemPromptState.Unanswered;

	/**
	 * An emitter that fires when the state of the prompt changes.
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
	 */
	set state(state: ActivityItemPromptState) {
		if (state !== this._state) {
			this._state = state;
			this._onStateChangedEmitter.fire();
		}
	}

	/**
	 * Gets the output lines.
	 */
	readonly outputLines: readonly ANSIOutputLine[];

	/**
	 * Gets or sets the answer.
	 */
	answer?: string = undefined;

	//#endregion Public Properties

	//#region Public Events

	/**
	 * An event that fires when the state changes.
	 */
	public onStateChanged = this._onStateChangedEmitter.event;

	//#endregion Public Events

	//#region Constructor

	/**
	 * Constructor.
	 * @param id The identifier.
	 * @param parentId The parent identifier.
	 * @param when The date.
	 * @param prompt The input prompt.
	 * @param code The code.
	 */
	constructor(
		id: string,
		parentId: string,
		when: Date,
		readonly prompt: string,
		readonly password: boolean
	) {
		// Call the base class's constructor.
		super(id, parentId, when);

		// Process the prompt directly into ANSI output lines suitable for rendering.
		this.outputLines = ANSIOutput.processOutput(prompt);
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
		return formatOutputLinesForClipboard(this.outputLines, commentPrefix);
	}

	//#endregion Public Methods
}
