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

export abstract class PositronViewPane extends ViewPane {
	private readonly _disposableStore: DisposableStore;

	/**
	 * Drive focus to an element inside the view.
	 * Called automatically by `focus()`.
	 */
	focusElement?(): void;

	constructor(
		options: IViewPaneOptions,
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
		this._disposableStore = this._register(new DisposableStore());

		// Make the viewpane focusable even when there are no components
		// available to take the focus. The viewpane must be able to take focus
		// at all times because otherwise blurring events do not occur and the
		// viewpane management state becomes confused on toggle.
		this.element.tabIndex = 0;
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
