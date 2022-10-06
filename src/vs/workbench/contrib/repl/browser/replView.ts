/*---------------------------------------------------------------------------------------------
 *  Copyright (c) RStudio, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/repl';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IThemeService, registerThemingParticipant } from 'vs/platform/theme/common/themeService';
import { IViewPaneOptions, ViewPane } from 'vs/workbench/browser/parts/views/viewPane';
import { IViewDescriptorService } from 'vs/workbench/common/views';
import { ReplInstanceView } from 'vs/workbench/contrib/repl/browser/replInstanceView';
import { IReplInstance, IReplService } from 'vs/workbench/contrib/repl/browser/repl';
import { editorErrorBackground, editorErrorForeground, textSeparatorForeground, iconForeground, descriptionForeground } from 'vs/platform/theme/common/colorRegistry';

/**
 * Holds the rendered REPL inside a ViewPane.
 */
export class ReplViewPane extends ViewPane {

	/** The containing HTML element that hosts the REPL view pane. */
	private _container?: HTMLElement;

	/** The REPL instance inside this view pane. Likely will be > 1 instance in the future. */
	private _instanceView?: ReplInstanceView;

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
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IReplService private readonly _replService: IReplService,
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

		// If there is already a REPL instance running, load it into the view.
		const instances = this._replService.instances;
		if (instances.length > 0) {
			this.createInstanceView(instances[0]);
		}

		// Listen for new REPL instances to start.
		this._replService.onDidStartRepl((e: IReplInstance) => {
			// We already have a REPL instance, and don't currently support more than one
			if (this._instanceView) {
				return;
			}

			// Create the instance!
			this.createInstanceView(e);
		});
	}

	/**
	 * Renders the body of the REPL view pane
	 *
	 * @param container The HTML element hosting the REPL pane
	 */
	override renderBody(container: HTMLElement): void {
		// Clear the DOM by removing all child elements. Note that we can't just
		// set innerHTML to an empty string, because Electron requires the
		// TrustedHTML claim to be set for innerHTML.
		for (let i = container.children.length - 1; i >= 0; i--) {
			container.removeChild(container.children[i]);
		}

		super.renderBody(container);

		// Save container
		this._container = container;

		// If we already have an instance, render it immediately
		if (this._instanceView) {
			this._instanceView.render(container);
			return;
		}
	}

	/**
	 * Create a new REPL instance view, and renders it into the view pane if
	 * the view pane is already rendered.
	 *
	 * @param instance The underlying REPL instance to show in the view
	 */
	private createInstanceView(instance: IReplInstance) {

		// Create a new instance view
		this._instanceView = this._instantiationService.createInstance(
			ReplInstanceView,
			instance);

		// Ensure the instance is disposed when the view is disposed
		this._register(this._instanceView);

		// Render the instance view if the view pane is already rendered
		if (this._container) {
			this._instanceView.render(this._container);
		}
	}
}

registerThemingParticipant((theme, collector) => {
	const errorFg = theme.getColor(editorErrorForeground);
	if (errorFg) {
		collector.addRule(`.repl-error { color: ${errorFg} ; }`);
	}
	const errorBg = theme.getColor(editorErrorBackground);
	if (errorBg) {
		collector.addRule(`.repl-error-message { background-color: ${errorBg} ; }`);
	}
	const descFg = theme.getColor(descriptionForeground);
	if (descFg) {
		collector.addRule(`.repl-error-name { color: ${descFg} ; }`);
		collector.addRule(`.repl-error-expander { color: ${descFg} ; }`);
	}
	const sep = theme.getColor(textSeparatorForeground);
	if (sep) {
		collector.addRule(`.repl-cell { border-top: 1px solid ${sep} ; }`);
	}
	const icon = theme.getColor(iconForeground);
	if (icon) {
		collector.addRule(`.repl-cell-executing .repl-indicator { background-color: ${icon} ; }`);
		collector.addRule(`.repl-cell-pending .repl-indicator { border: 1px solid ${icon} ; }`);
	}
});
