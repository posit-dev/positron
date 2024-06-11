/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { disposableTimeout } from 'vs/base/common/async';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IHoverService } from 'vs/platform/hover/browser/hover';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { IViewPaneOptions, ViewPane } from 'vs/workbench/browser/parts/views/viewPane';
import { IViewDescriptorService } from 'vs/workbench/common/views';

export interface PositronViewPaneOptions extends IViewPaneOptions {
	allowZeroMinimumBodySize?: boolean;
}

export abstract class PositronViewPane extends ViewPane {
	private readonly _disposableStore: DisposableStore;

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
		@ITelemetryService telemetryService: ITelemetryService,
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
			telemetryService,
			hoverService
		);

		// Override minimum size option if it isn't already somehow set. There doesn't seem to be a
		// way to set this in any sort of configuration hence the need to override it here. If this
		// isn't set, then the content of panes may occlude other parts of the editor when it is
		// resized to be very small. See the `onDidChangeBodyVisibility` handler for implications.
		if (options.allowZeroMinimumBodySize) {
			this.minimumBodySize = 0;
		}

		this._disposableStore = this._register(new DisposableStore());

		// Make the viewpane focusable even when there are no components
		// available to take the focus. The viewpane must be able to take focus
		// at all times because otherwise blurring events do not occur and the
		// viewpane management state becomes confused on toggle.
		this.element.tabIndex = 0;

		if (options.allowZeroMinimumBodySize) {
			// Register the onDidChangeBodyVisibility event handler.
			this._register(this.onDidChangeBodyVisibility(visible => {

				// If the view is height 0, then give it some height so it actually expands.
				if (visible) {
					// Quickly toggle the minimum body size. This is a synchronous way that will force
					// the element to have some height. We set the minimum body size to 0 first to ensure
					// that the view can be resized to be very small without spilling over, so we need to
					// set it back to the original minimum body size after.
					this.minimumBodySize = options.maximumBodySize ?? 50;
					this.minimumBodySize = 0;
				}
			}));
		}
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
