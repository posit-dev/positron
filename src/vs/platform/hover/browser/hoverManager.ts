/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IHoverService } from 'vs/platform/hover/browser/hover';
import { HoverPosition } from 'vs/base/browser/ui/hover/hoverWidget';
import { IHoverOptions, IHoverTarget, IHoverWidget } from 'vs/base/browser/ui/hover/hover';
import { Disposable, toDisposable } from 'vs/base/common/lifecycle';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';

/**
 * IHoverManager interface.
 */
export interface IHoverManager {
	/**
	 * Shows a hover.
	 * @param options A IHoverOptions that contains the hover options.
	 * @param focus A value which indicates whether to focus the hover when it is shown.
	 */
	showHover(options: IHoverOptions, focus?: boolean): void;

	/**
	 * Updates a hover.
	 * @param options A IHoverOptions that contains the hover options.
	 * @param focus A value which indicates whether to focus the hover when it is shown.
	 */
	updateHover(options: IHoverOptions, focus?: boolean): void;

	/**
	 * Hides a hover.
	 */
	hideHover(): void;
}

/**
 * HoverManager class.
 */
export class HoverManager extends Disposable implements IHoverManager {
	/**
	 * Gets or sets the hover leave time.
	 */
	private static _hoverLeaveTime: number = 0;

	/**
	 * The hover delay.
	 */
	private _hoverDelay: number;

	/**
	 * Gets or sets the timeout.
	 */
	private _timeout?: NodeJS.Timeout;

	/**
	 * Gets or sets the last hover target.
	 */
	private _lastHoverTarget?: IHoverTarget | HTMLElement;

	/**
	 * Gets or sets the last hover widget.
	 */
	private _lastHoverWidget?: IHoverWidget;

	/**
	 * Constructor.
	 * @param _compact A value which indicates whether the hover is compact.
	 * @param _configurationService The configuration service.
	 * @param _hoverService The hover service.
	 */
	constructor(
		private readonly _compact: boolean,
		private readonly _configurationService: IConfigurationService,
		private readonly _hoverService: IHoverService
	) {
		// Call the base class's method.
		super();

		// Initialize and track changes to the hover delay.
		this._hoverDelay = this._configurationService.getValue<number>('workbench.hover.delay');
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('workbench.hover.delay')) {
				this._hoverDelay = this._configurationService.getValue<number>('workbench.hover.delay');
			}
		}));

		// Hide the hover when the hover manager is disposed.
		this._register(toDisposable(() => this.hideHover()));
	}

	/**
	 * Shows a hover.
	 * @param options A IHoverOptions that contains the hover options.
	 * @param focus A value which indicates whether to focus the hover when it is shown.
	 */
	public showHover(options: IHoverOptions, focus?: boolean) {
		// Hide the hover.
		this.hideHover();

		/**
		 * Shows the hover.
		 * @param skipFadeInAnimation A value which indicates whether to skip fade in animation.
		 */
		const showHover = (skipFadeInAnimation: boolean) => {
			// Update the position and appearance options.
			options.position = { ...options.position, hoverPosition: HoverPosition.BELOW };
			options.appearance = { ...options.appearance, skipFadeInAnimation };

			// If the compact appearance is not set, set it.
			if (!options.appearance.compact) {
				options.appearance = { ...options.appearance, compact: this._compact };
			}

			// Show the hover and set the last hover widget.
			this._lastHoverTarget = options.target;
			this._lastHoverWidget = this._hoverService.showHover(options, focus);
		};

		// If a hover was recently shown, show the hover immediately and skip the fade in animation.
		// If not, schedule the hover for display with fade in animation.
		if (Date.now() - HoverManager._hoverLeaveTime < 200) {
			showHover(true);
		} else {
			// Set the timeout to show the hover.
			this._timeout = setTimeout(() => showHover(false), this._hoverDelay);
		}
	}

	/**
	 * Updates a hover.
	 * @param options A IHoverOptions that contains the hover options.
	 * @param focus A value which indicates whether to focus the hover when it is shown.
	 */
	public updateHover(options: IHoverOptions, focus?: boolean) {
		if (this._lastHoverTarget === options.target && this._lastHoverWidget) {
			this.showHover(options, focus);
		}
	}

	/**
	 * Hides a hover.
	 */
	public hideHover() {
		// Clear pending timeout.
		if (this._timeout) {
			clearTimeout(this._timeout);
			this._timeout = undefined;
		}

		this._lastHoverTarget = undefined;

		// If there is a last hover widget, dispose of it and set the hover leave time.
		if (this._lastHoverWidget) {
			this._lastHoverWidget.dispose();
			this._lastHoverWidget = undefined;
			HoverManager._hoverLeaveTime = Date.now();
		}
	}
}
