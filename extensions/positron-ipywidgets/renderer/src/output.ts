/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { JupyterLuminoPanelWidget } from '@jupyter-widgets/base';
import * as nbformat from '@jupyterlab/nbformat';
import * as outputBase from '@jupyter-widgets/output';
import { OutputAreaModel, OutputArea } from '@jupyterlab/outputarea';
import { PositronWidgetManager } from './manager';
import { KernelMessage } from '@jupyterlab/services';


export class OutputModel extends outputBase.OutputModel {
	// Properties assigned on `initialize`.
	private _outputs!: OutputAreaModel;
	public override widget_manager!: PositronWidgetManager;

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
		this._outputs = new OutputAreaModel({ trusted: true });

		this.listenTo(this, 'change:msg_id', this.setMsgId);
		this.listenTo(this, 'change:outputs', this.setOutputs);
	}

	public get outputs(): OutputAreaModel {
		return this._outputs;
	}

	private clearOutput(wait = false): void {
		this._outputs.clear(wait);
	}

	private setOutputs(_model: OutputModel, _value?: string[], options?: any): void {
		console.log('OutputModel.setOutputs', _value, options);
		if (!options?.newMessage) {
			// fromJSON does not clear the existing output
			this.clearOutput();
			// fromJSON does not copy the message, so we make a deep copy
			this._outputs.fromJSON(JSON.parse(JSON.stringify(this.get('outputs'))));
		}
	}

	private setMsgId(): void {
		const msgId = this.get('msg_id');
		const oldMsgId = this.previous('msg_id');

		if (msgId) {
			console.debug(`positron-ipywidgets renderer: Output widget '${this.model_id}' listening for messages with id '${msgId}'`);
		} else {
			console.debug(`positron-ipywidgets renderer: Output widget '${this.model_id}' no longer listening`);
		}

		const kernel = this.widget_manager.kernel;

		// Clear any old handler.
		if (oldMsgId && kernel) {
			kernel.removeMessageHook(oldMsgId, this.handleMessage);
		}

		// Register any new handler.
		if (msgId && kernel) {
			kernel.registerMessageHook(msgId, this.handleMessage);
		}
	}

	private handleMessage(msg: KernelMessage.IIOPubMessage): void {
		const msgType = msg.header.msg_type;
		switch (msgType) {
			case 'execute_result':
			case 'display_data':
			case 'stream':
			case 'error': {
				const model = msg.content as nbformat.IOutput;
				model.output_type = msgType as nbformat.OutputType;
				this._outputs.add(model);
				break;
			}
			// TODO: Positron supports this via a UI comm message and doesn't currently
			//       support clear_output.
			// case 'clear_output':
			// 	this.clearOutput((msg as KernelMessage.IClearOutputMsg).content.wait);
			// 	break;
			default:
				break;
		}
		this.set('outputs', this._outputs.toJSON(), { newMessage: true });
		this.save_changes();
	}
}

export class OutputView extends outputBase.OutputView {
	// TODO:
	override model!: OutputModel;
	private _outputView!: OutputArea;
	override luminoWidget!: JupyterLuminoPanelWidget;

	override _createElement(_tagName: string): HTMLElement {
		this.luminoWidget = new JupyterLuminoPanelWidget({ view: this });
		return this.luminoWidget.node;
	}

	override _setElement(el: HTMLElement): void {
		if (this.el || el !== this.luminoWidget.node) {
			// Boxes don't allow setting the element beyond the initial creation.
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
		this._outputView = new OutputArea({
			rendermime: this.model.widget_manager.renderMime,
			contentFactory: OutputArea.defaultContentFactory,
			model: this.model.outputs,
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
