/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
* ANSIOutputRun interface.
*/
interface ANSIOutputRun {
	/**
	 * The identifier of the output run.
	 */
	readonly id: string;

	/**
	 * The styles of the output run.
	 */
	readonly styles: string[];

	/**
	 * The custom foreground color of the output run. (in the form #RRGGBBAA)
	 */
	readonly customForegroundColor: string | undefined;

	/**
	 * The custom background color of the output run.
	 */
	readonly customBackgroundColor: string | undefined;

	/**
	 * The custom underlined color of the output run.
	 */
	readonly customUnderlinedColor: string | undefined;

	/**
	 * The text of the output run.
	 */
	readonly text: string;
}
