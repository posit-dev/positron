/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

export interface ITooltipManager {
	tooltipDelay(): number;
}

/**
 * HoverManager class.
 */
export class TooltipManager implements ITooltipManager {

	private lastTime?: number;

	constructor() {
	}

	tooltipDelay = () => {

		if (!this.lastTime) {
			this.lastTime = new Date().getTime();
			return 200;
		} else {
			return 0;
		}
	};
}
