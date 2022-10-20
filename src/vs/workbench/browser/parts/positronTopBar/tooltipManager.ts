/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

export interface ITooltipManager {
	shouldShowTooltip(): boolean;
}

/**
 * HoverManager class.
 */
export class TooltipManager implements ITooltipManager {

	// private lastTime?: Date;

	constructor() {

	}

	shouldShowTooltip = () => {
		return true;
	};
}
