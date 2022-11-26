/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./positronHelpView';
import * as React from 'react';
import * as DOM from 'vs/base/browser/dom';
import { Event, Emitter } from 'vs/base/common/event';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IViewDescriptorService } from 'vs/workbench/common/views';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ViewPane, IViewPaneOptions } from 'vs/workbench/browser/parts/views/viewPane';
import { IPositronHelpService } from 'vs/workbench/services/positronHelp/common/positronHelp';
import { PositronHelpActions } from 'vs/workbench/contrib/positronHelp/browser/positronHelpActions';
import { IReactComponentContainer, ISize, PositronReactRenderer } from 'vs/base/browser/positronReactRenderer';

/**
 * PositronHelpViewPane class.
 */
export class PositronHelpViewPane extends ViewPane implements IReactComponentContainer {

	// The PositronReactRenderer.
	positronReactRenderer: PositronReactRenderer | undefined;

	// The onSizeChanged event.
	private _onSizeChanged = this._register(new Emitter<ISize>());
	readonly onSizeChanged: Event<ISize> = this._onSizeChanged.event;

	// The onVisibilityChanged event.
	private _onVisibilityChanged = this._register(new Emitter<boolean>());
	readonly onVisibilityChanged: Event<boolean> = this._onVisibilityChanged.event;

	// The help container - contains the entire help UI.
	private _helpContainer!: HTMLElement;

	// The help action bars container - contains the PositronHelpActionBars component.
	private _helpActionBarsContainer!: HTMLElement;

	// The help content that is currently being renderd.
	// private _helpContent!: HTMLElement;

	// The help iframe.
	private _helpIFrame!: HTMLIFrameElement;

	// The current help result.
	private _helpResult?: TrustedHTML;

	// Constructor.
	constructor(
		options: IViewPaneOptions,
		@ICommandService private readonly commandService: ICommandService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IOpenerService openerService: IOpenerService,
		@IPositronHelpService private readonly positronHelpService: IPositronHelpService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);
		this._register(this.onDidChangeBodyVisibility(() => this.onDidChangeVisibility(this.isBodyVisible())));

		this._register(this.positronHelpService.onRenderHelp(e => {
			console.log('PositronHelpViewPane got onRenderHelp');
			console.log(e);

			this._helpResult = e;

			const fart = this._helpResult as unknown as string;
			this._helpIFrame.contentWindow?.document.open();
			this._helpIFrame.contentWindow?.document.write(fart);
			this._helpIFrame.contentWindow?.document.close();


			//HTMLIFrameElement

			// const trustedHtml = this._helpResult ? ttPolicyPositronHelp?.createHTML(this._helpResult.element.innerHTML) : '<span></span>';
			// if (trustedHtml) {
			// 	const fart = trustedHtml as unknown as string;
			// 	this._helpIFrame.contentWindow?.document.open();
			// 	this._helpIFrame.contentWindow?.document.write(fart);
			// 	this._helpIFrame.contentWindow?.document.close();
			// }

			// const trustedHtml = ttPolicy?.createHTML('<p>This is an iframe</p><p>Trusted HTML that represents the help.</p><p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Mauris eu venenatis nibh, eget molestie mauris. Nullam dictum elementum purus, nec porttitor magna. Aliquam ac libero semper, sollicitudin purus eu, fringilla tortor. Etiam vitae nibh dictum, dignissim erat vitae, molestie metus. Nunc rutrum nec metus vitae auctor. In iaculis justo non lacus ultricies laoreet. Aliquam erat volutpat. Etiam sed mi erat. Praesent feugiat risus a turpis facilisis faucibus. Maecenas vel sollicitudin urna.</p><p>Donec ex sapien, luctus a convallis at, dictum vitae lacus. Vestibulum dapibus libero eu ante tempor porta. Duis posuere maximus justo nec vulputate. Vivamus tempor ante at elit vehicula volutpat. Praesent suscipit sed ipsum a euismod. Fusce efficitur metus risus, nec condimentum diam convallis ut. Aenean varius fringilla interdum. Donec non iaculis orci. Etiam cursus lorem lorem, eu tincidunt enim molestie vel.</p><p>Duis vestibulum accumsan arcu, a vulputate augue cursus quis. Pellentesque sollicitudin, quam nec vestibulum lacinia, sem erat sagittis leo, quis dictum mi mi in leo. Integer porta non velit eget fermentum. Etiam ac posuere enim. Sed vulputate ligula egestas, vehicula odio ut, pharetra orci. Fusce dapibus accumsan ex, nec faucibus lorem venenatis eu. In ultricies efficitur nunc, eget malesuada neque congue sit amet. Maecenas in dignissim neque. Fusce placerat eu arcu vitae elementum. Nam pharetra, ipsum vitae ultricies convallis, ex sapien egestas ligula, eget eleifend dui ex nec elit. Quisque a bibendum ipsum, et porta ante.</p><p>Cras condimentum velit et ipsum vulputate tempor. Cras rutrum massa ut consectetur feugiat. Vestibulum scelerisque vitae eros sed lacinia. Donec a tellus faucibus, ornare ante eget, mollis purus. Nam lobortis non diam ut venenatis. Etiam nec ultrices dui, id vulputate ex. In pharetra finibus dui, nec placerat dui varius sit amet. Mauris interdum feugiat eros, mattis porta mauris bibendum vulputate. Proin elit quam, tempus ac aliquam ac, egestas et enim. Donec vel enim diam. Quisque sit amet eleifend nunc. Cras eu nisl quis mauris tincidunt aliquet. Donec dictum consectetur elit, nec tempor erat sagittis vel.</p>');
			// if (trustedHtml) {
			// 	const fart = trustedHtml as unknown as string;
			// 	this._helpIFrame.contentWindow?.document.open();
			// 	this._helpIFrame.contentWindow?.document.write(fart);
			// 	this._helpIFrame.contentWindow?.document.close();
			// }
		}));
	}

	public override dispose(): void {
		if (this.positronReactRenderer) {
			this.positronReactRenderer.destroy();
			this.positronReactRenderer = undefined;
		}

		super.dispose();
	}

	override focus(): void {
		// Call the base class's method.
		super.focus();
	}

	protected override renderBody(parent: HTMLElement): void {
		// Call the base class's method.
		super.renderBody(parent);

		// Append the help container.
		this._helpContainer = DOM.$('.positron-help-container');
		parent.appendChild(this._helpContainer);

		// Append the help action bars container.
		this._helpActionBarsContainer = DOM.$('.positron-help-action-bars-container');
		this._helpContainer.appendChild(this._helpActionBarsContainer);

		// Render the Positron help action bars component.
		this.positronReactRenderer = new PositronReactRenderer(this._helpActionBarsContainer);
		this.positronReactRenderer.render(
			<PositronHelpActions
				commandService={this.commandService}
				configurationService={this.configurationService}
				contextKeyService={this.contextKeyService}
				contextMenuService={this.contextMenuService}
				keybindingService={this.keybindingService}
				positronHelpService={this.positronHelpService}
				reactComponentContainer={this}
				onPreviousTopic={() => console.log('Previous topic made it to the Positron help view.')}
				onNextTopic={() => console.log('Next topic made it to the Positron help view.')}
				onFind={findText => console.log(`Find ${findText} made it to the Positron help view.`)}
				onFindPrevious={() => {
					if (this._helpIFrame.contentWindow) {
						this._helpIFrame.contentWindow.postMessage('find-previous');
						this._helpIFrame.contentWindow.focus();
					}
					console.log('Find previous topic made it to the Positron help view.');
				}}
				onFindNext={() => {
					if (this._helpIFrame.contentWindow) {
						this._helpIFrame.contentWindow.postMessage('find-next');
						this._helpIFrame.contentWindow.focus();
					}
					console.log('Find next topic made it to the Positron help view.');
				}}
			/>
		);

		// // Append the help content.
		// this._helpContent = DOM.$('.positron-help-content');
		// this._helpContainer.appendChild(this._helpContent);

		this._helpIFrame = DOM.$('iframe.positron-help-frame');
		this._helpContainer.appendChild(this._helpIFrame);
	}

	override layoutBody(height: number, width: number): void {
		// Call the base class's method.
		super.layoutBody(height, width);

		// Raise the onSizeChanged event.
		this._onSizeChanged.fire({
			width,
			height
		});
	}

	private onDidChangeVisibility(visible: boolean): void {
		// Raise the onVisibilityChanged event.
		this._onVisibilityChanged.fire(visible);
	}
}
