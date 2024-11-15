/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2022-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { IHoverService } from 'vs/platform/hover/browser/hover';
import { IManagedHover } from 'vs/base/browser/ui/hover/hover';
import { Disposable, toDisposable } from 'vs/base/common/lifecycle';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IHoverDelegate, IHoverDelegateOptions } from 'vs/base/browser/ui/hover/hoverDelegate';

/**
 * IHoverManager interface.
 */
export interface IHoverManager {
	/**
	 * Sets up a managed hover.
	 * @param targetElement The target element to show the hover for.
	 * @param content The content to show in the hover.
	 * @returns The managed hover.
	 */
	setupManagedHover(targetElement: HTMLElement, text: string): IManagedHover;

	/**
	 * Hides the hover if it was visible.
	 */
	hideHover(): void;
}

/**
 * HoverManager class.
 */
export class HoverManager extends Disposable implements IHoverManager, IHoverDelegate {
	//#region Private Properties

	/**
	 * The hover delay.
	 */
	private _hoverDelay: number;

	/**
	 * Gets or sets the hover leave time.
	 */
	private _hoverLeaveTime: number = 0;

	//#endregion Private Properties

	//#region Constructor

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

	//#endregion Constructor

	//#region IHoverManager Implementation

	showHover(options: IHoverDelegateOptions, focus?: boolean): IHoverWidget | undefined {

		return this._hoverService.showHover({
			...options,
			// ...overrideOptions,
			persistence: {
				hideOnKeyDown: true,
				// ...overrideOptions.persistence
			},
			// id,
			appearance: {
				...options.appearance,
				compact: true,
				skipFadeInAnimation: this.isInstantlyHovering(),
				// ...overrideOptions.appearance
			}
		}, false);


		// return this._hoverService.showHover(options, false);
		// // Update the position and appearance options.
		// options.position = { ...options.position, hoverPosition: HoverPosition.BELOW };
		// options.appearance = { ...options.appearance, skipFadeInAnimation };

		// // If the compact appearance is not set, set it.
		// if (!options.appearance.compact) {
		// 	options.appearance = { ...options.appearance, compact: this._compact };
		// }

		// // Show the hover and set the last hover widget.
		// this._lastHoverTarget = options.target;
		// this._lastHoverWidget = this._hoverService.showHover(options, focus);
	}

	onDidHideHover(): void {
		this._hoverLeaveTime = Date.now();
	}

	get delay() {
		const result = this.isInstantlyHovering() ? 0 : this._hoverDelay;
		console.log(`Hover manager hover delay is ${result}`);
		return result;
	}

	get placement(): 'element' | 'mouse' | undefined {
		return 'element';
	}

	get showNativeHover(): boolean | undefined {
		return false;
	}

	//#endregion IHoverManager Implementation

	//#region IHoverDelegate Implementation

	/**
	 * Sets up a managed hover.
	 * @param targetElement The target element to show the hover for.
	 * @param content The content to show in the hover.
	 * @returns The managed hover.
	 */
	public setupManagedHover(targetElement: HTMLElement, content: string): IManagedHover {
		const x = this._hoverService.setupManagedHover(this, targetElement, content);
		return x;
	}

	/**
	 * Hides the hover if it was visible.
	 */
	public hideHover() {
		this._hoverService.hideHover();
	}

	//#region IHoverDelegate Implementation

	//#region Private Methods

	private isInstantlyHovering(): boolean {
		return Date.now() - this._hoverLeaveTime < 200;
	}

	//#endregion Private Methods
}
