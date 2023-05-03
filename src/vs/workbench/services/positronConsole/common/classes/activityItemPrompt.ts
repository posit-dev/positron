/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { ANSIOutput, ANSIOutputLine } from 'vs/base/common/ansi/ansiOutput';

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
export class ActivityItemPrompt {
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
		readonly id: string,
		readonly parentId: string,
		readonly when: Date,
		readonly prompt: string,
		readonly password: boolean
	) {
		// Process the prompt directly into ANSI output lines suitable for rendering.
		this.outputLines = ANSIOutput.processOutput(prompt);
	}

	//#endregion Constructor
}
