/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { ActivityItem } from './activityItem.js';
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
	//#region Public Properties

	/**
	 * Gets the output lines.
	 */
	readonly outputLines: readonly ANSIOutputLine[];

	/**
	 * Gets or sets the state.
	 */
	state = ActivityItemPromptState.Unanswered;

	/**
	 * Gets or sets the answer.
	 */
	answer: string | undefined = undefined;

	//#endregion Public Properties

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
}
