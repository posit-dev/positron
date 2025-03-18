/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IHoverWidget } from '../../../base/browser/ui/hover/hover.js';
import { IHoverService } from '../../hover/browser/hover.js';
import { Disposable, toDisposable } from '../../../base/common/lifecycle.js';
import { HoverPosition } from '../../../base/browser/ui/hover/hoverWidget.js';
import { IHoverManager } from '../../hover/browser/hoverManager.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';

/**
 * Constants.
 */
const INSTANT_HOVER_TIME_LIMIT = 200;

/**
 * PositronActionBarHoverManager class.
 */
export class PositronActionBarHoverManager extends Disposable implements IHoverManager {
	//#region Private Properties

	/**
	 * The hover delay.
	 */
	private _hoverDelay: number;

	/**
	 * A custom hover delay to override the one from the configuration service.
	 */
	private _customHoverDelay: number | undefined;

	/**
	 * Gets or sets the hover leave time.
	 */
	private _hoverLeaveTime: number = 0;

	/**
	 * Gets or sets the timeout.
	 */
	private _timeout?: NodeJS.Timeout;

	/**
	 * Gets or sets the last hover widget.
	 */
	private _lastHoverWidget?: IHoverWidget;

	/**
	 * Gets a value which indicates whether the hover is instantly hovering.
	 * @returns A value which indicates whether the hover is instantly hovering.
	 */
	private get isInstantlyHovering(): boolean {
		return Date.now() - this._hoverLeaveTime < INSTANT_HOVER_TIME_LIMIT;
	}

	//#endregion Private Properties

	//#region Constructor & Dispose

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

		// Initialize and track changes to the hover delay configuration.
		this._hoverDelay = this._configurationService.getValue<number>('workbench.hover.delay');
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('workbench.hover.delay') && !this._customHoverDelay) {
				this._hoverDelay = this._configurationService.getValue<number>('workbench.hover.delay');
			}
		}));

		// Hide the hover when the hover manager is disposed.
		this._register(toDisposable(() => this._hoverService.hideHover()));
	}

	/**
	 * Disposes the hover manager.
	 */
	override dispose(): void {
		// Clear pending timeout.
		if (this._timeout) {
			clearTimeout(this._timeout);
			this._timeout = undefined;
		}

		// If there is a last hover widget, dispose of it.
		if (this._lastHoverWidget) {
			this._lastHoverWidget.dispose();
			this._lastHoverWidget = undefined;
		}

		// Call the base class's dispose method.
		super.dispose();
	}

	//#endregion Constructor & Dispose

	//#region Public Methods

	/**
	 * Shows a hover.
	 * @param target The target.
	 * @param content The content.
	 */
	public showHover(target: HTMLElement, content?: string | (() => string | undefined)): void {
		// Hide the hover.
		this.hideHover();

		// If there is no content, return.
		if (!content) {
			return;
		}

		/**
		 * Shows the hover.
		 * @param content The content.
		 * @param skipFadeInAnimation A value which indicates whether to skip fade in animation.
		 */
		const showHover = (content: string, skipFadeInAnimation: boolean) => {
			// Show the hover and set the last hover widget.
			this._lastHoverWidget = this._hoverService.showHover({
				content,
				target,
				position: {
					hoverPosition: HoverPosition.BELOW
				},
				persistence: {
					hideOnKeyDown: true,
					hideOnHover: false
				},
				appearance: {
					compact: this._compact,
					showPointer: true,
					skipFadeInAnimation
				}
			}, false);
		};

		// Get the content.
		if (typeof content !== 'string') {
			content = content();
			if (!content) {
				return;
			}
		}

		// If a hover was recently shown, show the hover immediately and skip the fade in animation.
		// If not, schedule the hover for display with fade in animation.
		if (this.isInstantlyHovering) {
			showHover(content, true);
		} else {
			// Set the timeout to show the hover.
			this._timeout = setTimeout(() =>
				showHover(content, false),
				this._hoverDelay
			);
		}
	}

	/**
	 * Set the hover delay to the specified value.
	 */
	public setCustomHoverDelay(hoverDelay: number): void {
		this._customHoverDelay = hoverDelay;
		this._hoverDelay = hoverDelay;
	}

	/**
	 * Hides the hover.
	 */
	public hideHover(): void {
		// Clear pending timeout.
		if (this._timeout) {
			clearTimeout(this._timeout);
			this._timeout = undefined;
		}

		// If there is a last hover widget, dispose of it and set the hover leave time.
		if (this._lastHoverWidget) {
			this._lastHoverWidget.dispose();
			this._lastHoverWidget = undefined;
			this._hoverLeaveTime = Date.now();
		}
	}

	//#endregion Public Methods
}
