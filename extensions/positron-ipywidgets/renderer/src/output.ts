/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { JupyterLuminoPanelWidget } from '@jupyter-widgets/base';
import * as outputBase from '@jupyter-widgets/output';
import * as nbformat from '@jupyterlab/nbformat';
import { OutputArea, OutputAreaModel } from '@jupyterlab/outputarea';
import { Disposable } from 'vscode-notebook-renderer/events';
import { PositronWidgetManager } from './manager';

/** Options when setting the `outputs` state. */
export interface ISetOutputOptions {
	newMessage?: boolean;
}

/**
 * The output widget's backing model.
 *
 * Adapted from the open source jupyter-widgets/ipywidgets repo for use in Positron.
 */
export class OutputModel extends outputBase.OutputModel {
	// Properties assigned on `super.initialize`.
	private _outputAreaModel!: OutputAreaModel;
	public override widget_manager: PositronWidgetManager = undefined!;

	/** The current message handler's disposable, if any. */
	private _messageHandler?: Disposable;

	// Initial state.
	public override defaults(): Backbone.ObjectHash {
		return {
			...super.defaults(),
			msg_id: '',
			outputs: [],
		};
	}

	public override initialize(attributes: any, options: any): void {
		super.initialize(attributes, options);

		// The output area model is trusted since widgets are only rendered in trusted contexts.
		this._outputAreaModel = new OutputAreaModel({ trusted: true });

		this.listenTo(this, 'change:msg_id', this.handleChangeMsgId);
		this.listenTo(this, 'change:outputs', this.handleChangeOutputs);
	}

	public get outputAreaModel(): OutputAreaModel {
		return this._outputAreaModel;
	}

	private get msgId(): string {
		return this.get('msg_id');
	}

	private get outputs(): unknown[] {
		return this.get('outputs');
	}

	private handleChangeMsgId(): void {
		// Dispose the existing handler, if any.
		this._messageHandler?.dispose();

		// Register the new handler, if any.
		if (this.msgId.length > 0) {
			this._messageHandler = this.widget_manager.onDidReceiveKernelMessage(this.msgId, (message) => {

				// Update the output area model based on the message.
				switch (message.type) {
					case 'execute_result': {
						const output: nbformat.IExecuteResult = {
							output_type: 'execute_result',
							// Positron runtime execute_result messages don't currently include
							// execution_count, so we'll leave it as null.
							execution_count: null,
							data: message.data as nbformat.IMimeBundle,
							metadata: message.metadata as nbformat.OutputMetadata,
						};
						this._outputAreaModel.add(output);
						break;
					}
					case 'display_data': {
						const output: nbformat.IDisplayData = {
							output_type: 'display_data',
							data: message.data as nbformat.IMimeBundle,
							metadata: message.metadata as nbformat.OutputMetadata,
						};
						this._outputAreaModel.add(output);
						break;
					}
					case 'stream': {
						const output: nbformat.IStream = {
							output_type: 'stream',
							name: message.name,
							text: message.text,
						};
						this._outputAreaModel.add(output);
						break;
					}
					case 'error': {
						const output: nbformat.IError = {
							output_type: 'error',
							ename: message.name,
							evalue: message.message,
							traceback: message.traceback,
						};
						this._outputAreaModel.add(output);
						break;
					}
					case 'clear_output': {
						this._outputAreaModel.clear(message.wait);
						break;
					}
				}

				// Update the `outputs` state.
				const options: ISetOutputOptions = { newMessage: true };
				this.set('outputs', this._outputAreaModel.toJSON(), options);

				// Push the model's new state to the kernel.
				this.save_changes();
			});
		}
	}

	private handleChangeOutputs(_model: OutputModel, _value: string[], options: ISetOutputOptions): void {
		// If the state change was initiated by the kernel and not us (i.e. newMessage is undefined),
		// update the output area model using the new state.
		if (!options?.newMessage) {
			// Clear any existing outputs.
			this._outputAreaModel.clear();
			// Make a deepcopy of the output since the output area model may mutate it.
			const outputs = JSON.parse(JSON.stringify(this.outputs));
			// Update the output area model.
			this._outputAreaModel.fromJSON(outputs);
		}
	}
}

/**
 * The output widget's view.
 *
 * Largely copied from the open source jupyter-widgets/ipywidgets repo.
 */
export class OutputView extends outputBase.OutputView {
	// Properties assigned on parent class initialization.
	override model: OutputModel = undefined!;
	private _outputView!: OutputArea;
	override luminoWidget: JupyterLuminoPanelWidget = undefined!;

	constructor(options?: any) {
		super(options);
		if (options.model) {
			this.model = options.model;
		}
	}

	private ensureLuminoWidget() {
		if (!this.luminoWidget) {
			this.luminoWidget = new JupyterLuminoPanelWidget({ view: this });
		}
	}

	override _createElement(_tagName: string): HTMLElement {
		this.ensureLuminoWidget();
		return this.luminoWidget.node;
	}

	override _setElement(el: HTMLElement): void {
		if (this.el || el !== this.luminoWidget.node) {
			throw new Error('Cannot reset the DOM element.');
		}

		this.el = this.luminoWidget.node;
		this.$el = $(this.luminoWidget.node);
	}

	/**
	 * Called when view is rendered.
	 */
	override render(): void {
		super.render();
		this.ensureLuminoWidget();
		this._outputView = new OutputArea({
			rendermime: this.model.widget_manager.renderMime,
			contentFactory: OutputArea.defaultContentFactory,
			model: this.model.outputAreaModel,
		});
		this.luminoWidget.insertWidget(0, this._outputView);

		this.luminoWidget.addClass('jupyter-widgets');
		this.luminoWidget.addClass('widget-output');
		this.update(); // Set defaults.
	}

	override remove(): any {
		this._outputView.dispose();
		return super.remove();
	}
}
