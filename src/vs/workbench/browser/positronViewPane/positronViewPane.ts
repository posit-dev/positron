/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
import * as DOM from '../../../base/browser/dom.js';
import { disposableTimeout } from '../../../base/common/async.js';
import { DisposableStore } from '../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../platform/theme/common/themeService.js';
import { IViewPaneOptions, ViewPane } from '../parts/views/viewPane.js';
import { IViewDescriptorService } from '../../common/views.js';

export interface PositronViewPaneOptions extends IViewPaneOptions {
	openFromCollapsedSize?: number | `${number}%`;
}

export abstract class PositronViewPane extends ViewPane {
	private readonly _disposableStore: DisposableStore;

	/**
	 * Variable used to remember how large the view was when it was last resized by the user or
	 * something else that caused the `layout` method to be called. This is used in conjunction
	 * with the `openFromCollapsedSize` option to determine how large the view should be when it is
	 * opened from a collapsed state. If the last user size is smaller than the lower bound, then
	 * the view will be opened to the pop-open size. If the last user size is larger than the lower
	 * bound, then the view will be opened to that size.
	 */
	private _lastLayoutSize: number | undefined = undefined;

	/**
	 * The last-layout size below which we will pop the view open to the openFromCollapsedSize.
	 */
	static readonly MinOpenFromCollapseThreshold = 100;

	/**
	 * Drive focus to an element inside the view.
	 * Called automatically by `focus()`.
	 */
	focusElement?(): void;

	constructor(
		options: PositronViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
	) {
		super(
			options,
			keybindingService,
			contextMenuService,
			configurationService,
			contextKeyService,
			viewDescriptorService,
			instantiationService,
			openerService,
			themeService,
			hoverService
		);

		// Override minimum size option if it isn't already somehow set. There doesn't seem to be a
		// way to set this in any sort of configuration hence the need to override it here. If this
		// isn't set, then the content of panes may occlude other parts of the editor when it is
		// resized to be very small. See the `onDidChangeBodyVisibility` handler for implications.
		if (options.openFromCollapsedSize) {
			this.minimumBodySize = 0;
		}

		this._disposableStore = this._register(new DisposableStore());

		// Make the viewpane focusable even when there are no components
		// available to take the focus. The viewpane must be able to take focus
		// at all times because otherwise blurring events do not occur and the
		// viewpane management state becomes confused on toggle.
		this.element.tabIndex = 0;

		if (options.openFromCollapsedSize) {
			// Register the onDidChangeBodyVisibility event handler.
			this._register(this.onDidChangeBodyVisibility(visible => {

				// If the view is height 0, then give it some height so it actually expands.
				if (visible) {
					// Quickly toggle the minimum body size. This is a synchronous way that will force
					// the element to have some height. We set the minimum body size to 0 first to ensure
					// that the view can be resized to be very small without spilling over, so we need to
					// set it back to the original minimum body size after.
					this.minimumBodySize = options.minimumBodySize ?? this._getOpenFromCollapsedSize(options.openFromCollapsedSize);
					this.minimumBodySize = 0;
				}
			}));
		}
	}

	override layout(size: number): void {
		// Remember the last layout size. Subtract 22 for the height of the header panel
		// TODO: Figure out how to get the height of the header panel dynamically
		this._lastLayoutSize = size - 22;

		super.layout(size);
	}

	/**
	 * Helper function to get the openFromCollapsedSize value as a number of pixels.
	 * @returns How large the view should be when it is opened from a collapsed state in pixels.
	 */
	private _getOpenFromCollapsedSize(openFromCollapsedSize: PositronViewPaneOptions['openFromCollapsedSize']): number {

		// If the last layout size was larger than our lower bound, we'll use that as the last user
		// size. Otherwise, we'll reset it to undefined so the next time we open from collapsed,
		// we'll use the pop-open size to ensure the pane is reasonably sized.
		if (this._lastLayoutSize && this._lastLayoutSize > PositronViewPane.MinOpenFromCollapseThreshold) {
			return this._lastLayoutSize;
		}

		// If the value is a plain number then it refers to pixels and we don't need to do anything
		// special to it.
		if (typeof openFromCollapsedSize === 'number') {
			return openFromCollapsedSize;
		}

		// If the number is a string then it must represent a percentage of the window height. Here
		// we need to convert it to pixels based on the current window height.
		if (typeof openFromCollapsedSize === 'string') {
			const popOpenPercent = parseFloat(openFromCollapsedSize);

			if (isNaN(popOpenPercent)) {
				throw new Error(`Invalid value for openFromCollapsedSize: ${openFromCollapsedSize}`);
			}

			const windowHeight = DOM.getWindow(this.element).innerHeight;
			return windowHeight * popOpenPercent / 100;
		}

		throw new Error(`Invalid value for openFromCollapsedSize: ${openFromCollapsedSize}`);
	}

	override focus(): void {
		// We focus at the next tick because in some cases `focus()` is called
		// when the viewpane is not visible yet (don't trust `this.isBodyVisible()`).
		// In this case the `focus()` call fails (don't trust `this.onFocus()`).
		// This happens for instance with `workbench.action.togglePanel` or
		// `workbench.action.toggleSecondarySideBar`. Not doing it at the next tick
		// would result in broken viewpane toggling, see
		// https://github.com/posit-dev/positron/pull/2867
		const focus = () => {
			// The base class focuses the whole pane (we set its tabIndex to make this possible).
			super.focus();

			// Drive focus to an inner element if any. Also needs to be at the next tick,
			// and after the `super.focus()` call.
			this.focusElement?.();
		};
		disposableTimeout(focus, 0, this._disposableStore);
	}

}
