/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { IViewPaneOptions, ViewPane } from 'vs/workbench/browser/parts/views/viewPane';
import { IViewDescriptorService } from 'vs/workbench/common/views';
import { ILanguageRuntimeService } from 'vs/workbench/contrib/languageRuntime/common/languageRuntimeService';

/**
 * Holds the rendered REPL inside a ViewPane.
 */
export class ReplViewPane extends ViewPane {
	constructor(options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@ITelemetryService telemetryService: ITelemetryService,
		@ILanguageRuntimeService private _languageRuntimeService: ILanguageRuntimeService
	) {
		super(options,
			keybindingService,
			contextMenuService,
			configurationService,
			contextKeyService,
			viewDescriptorService,
			instantiationService,
			openerService,
			themeService,
			telemetryService);
	}

	/**
	 * Renders the body of the REPL view pane
	 *
	 * @param container The HTML element hosting the REPL pane
	 */
	override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		const t = document.createElement('h1');
		const kernel = this._languageRuntimeService.getActiveRuntime(null);
		if (kernel) {
			t.innerText = kernel.label;
		} else {
			t.innerText = 'No kernel is active.';
		}
		container.appendChild(t);
	}
}
