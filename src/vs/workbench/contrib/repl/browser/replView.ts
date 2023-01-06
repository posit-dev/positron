/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit Software, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/repl';
import * as DOM from 'vs/base/browser/dom';
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
 * ReplInstanceEntry interface.
 */
interface ReplInstanceEntry {
	readonly replInstanceViewContainer: HTMLElement;
	readonly replInstanceView: ReplInstanceView;
}

/**
 * Holds the rendered REPL inside a ViewPane.
 */
export class ReplViewPane extends ViewPane {

	/** The repl container. The active repl instance is displayed in this container. */
	private _replContainer: HTMLElement;

	/** The repl instance entries. */
	private replInstanceEntries = new Map<IReplInstance, ReplInstanceEntry>();

	/** The active repl instance entry. */
	private _activeReplInstanceEntry: ReplInstanceEntry | undefined;

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

		// Create repl instance view container view.
		this._replContainer = DOM.$('.repl-container');

		// Listen for focus events from ViewPane
		this.onDidFocus(() => {
			if (this._activeReplInstanceEntry) {
				this._activeReplInstanceEntry.replInstanceView.takeFocus();
			}
		});
	}

	/**
	 * Renders the body of the REPL view pane
	 *
	 * @param parent The HTML element hosting the REPL pane
	 */
	override renderBody(parent: HTMLElement): void {
		// Call the base class's method.
		super.renderBody(parent);

		// Append repl container.
		parent.appendChild(this._replContainer);

		// If there are already repl instances in the repl service, create their repl instance entries
		// and activate the last one.
		this._replService.instances.forEach((replInstance, index, replInstances) => {
			this.createReplInstanceEntry(replInstance);
		});

		// Add the onDidStartRepl event handler.
		this._register(this._replService.onDidStartRepl(replInstance => {
			this.createReplInstanceEntry(replInstance);
		}));

		// Add the onDidChangeActiveRepl event handler.
		this._replService.onDidChangeActiveRepl(replInstance => {
			this.activateReplInstance(replInstance);
		});
	}

	/**
	 * Creates a new repl instance entry.
	 * @param replInstance The underlying REPL instance to show in the view.
	 */
	private createReplInstanceEntry(replInstance: IReplInstance) {
		// Create the repl instance view container.
		const replInstanceViewContainer = DOM.$('.repl-instance-view-container');

		// Create the repl instance view.
		const replInstanceView = this._register(this._instantiationService.createInstance(
			ReplInstanceView,
			replInstance));

		// Render the repl instance view into the repl instance view container.
		replInstanceView.render(replInstanceViewContainer);

		// Create the repl instance entry.
		const replInstanceEntry: ReplInstanceEntry = {
			replInstanceViewContainer,
			replInstanceView
		};

		// Set the REPL instance entry tp the repl instance entries.
		this.replInstanceEntries.set(replInstance, replInstanceEntry);

		// Activate the repl instance entry, if asked to do so.
		// if (activate) {
		// 	this._activeReplInstanceEntry?.replInstanceViewContainer.remove();
		// 	this._replContainer.append(replInstanceViewContainer);
		// 	this._activeReplInstanceEntry = replInstanceEntry;
		// }
	}

	/**
	 * Activates a REPL instance.
	 * @param replInstance The REPL instance to activate.
	 */
	private activateReplInstance(replInstance: IReplInstance | undefined) {
		this._activeReplInstanceEntry?.replInstanceViewContainer.remove();
		if (replInstance) {
			const replInstanceEntry = this.replInstanceEntries.get(replInstance);
			if (replInstanceEntry) {
				this._replContainer.append(replInstanceEntry.replInstanceViewContainer);
				this._activeReplInstanceEntry = replInstanceEntry;
			}
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
