/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

/**
 * Represents an event from the kernel. This is a non-standard message only used
 * by Positron.
 */
export interface PositronEvent {
	/** The name of the event */
	name: string;

	/** The event data */
	data: object;
}
