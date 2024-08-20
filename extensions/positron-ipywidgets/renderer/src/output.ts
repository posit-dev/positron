/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { JupyterLuminoPanelWidget } from '@jupyter-widgets/base';
import * as nbformat from '@jupyterlab/nbformat';
import * as outputBase from '@jupyter-widgets/output';
import { OutputAreaModel, OutputArea } from '@jupyterlab/outputarea';
import { PositronWidgetManager } from './manager';
import { KernelMessage, Session } from '@jupyterlab/services';


export class OutputModel extends outputBase.OutputModel {
	// Properties assigned in initialize.
	private _outputs!: OutputAreaModel;
	override widget_manager!: PositronWidgetManager;
	private _msgHook!: (msg: KernelMessage.IIOPubMessage) => boolean;

	override defaults(): Backbone.ObjectHash {
		return {
			...super.defaults(),
			msg_id: '',
			outputs: [],
		};
	}

	override initialize(attributes: any, options: any): void {
		super.initialize(attributes, options);
		// The output area model is trusted since widgets are only rendered in trusted contexts.
		this._outputs = new OutputAreaModel({ trusted: true });
		this._msgHook = (msg): boolean => {
			this.add(msg);
			return false;
		};

		// TODO: Handle kernel changes?
		// if the context is available, react on kernel changes
		// this.widget_manager.context.sessionContext.kernelChanged.connect(
		// 	(sender, args) => {
		// 		this._handleKernelChanged(args);
		// 	}
		// );
		this.listenTo(this, 'change:msg_id', this.reset_msg_id);
		this.listenTo(this, 'change:outputs', this.setOutputs);
		this.setOutputs();
	}

	get outputs(): OutputAreaModel {
		return this._outputs;
	}

	clear_output(wait = false): void {
		this._outputs.clear(wait);
	}

	setOutputs(_model?: any, _value?: any, options?: any): void {
		if (!(options && options.newMessage)) {
			// fromJSON does not clear the existing output
			this.clear_output();
			// fromJSON does not copy the message, so we make a deep copy
			this._outputs.fromJSON(JSON.parse(JSON.stringify(this.get('outputs'))));
		}
	}

	/**
	 * Register a new kernel
	 */
	_handleKernelChanged({
		oldValue,
	}: Session.ISessionConnection.IKernelChangedArgs): void {
		const msgId = this.get('msg_id');
		if (msgId && oldValue) {
			oldValue.removeMessageHook(msgId, this._msgHook);
			this.set('msg_id', null);
		}
	}

	/**
	 * Reset the message id.
	 */
	reset_msg_id(): void {
		const kernel = this.widget_manager.kernel;
		const msgId = this.get('msg_id');
		const oldMsgId = this.previous('msg_id');

		// Clear any old handler.
		if (oldMsgId && kernel) {
			kernel.removeMessageHook(oldMsgId, this._msgHook);
		}

		// Register any new handler.
		if (msgId && kernel) {
			kernel.registerMessageHook(msgId, this._msgHook);
		}
	}

	add(msg: KernelMessage.IIOPubMessage): void {
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
			case 'clear_output':
				this.clear_output((msg as KernelMessage.IClearOutputMsg).content.wait);
				break;
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
	 **/
	override render(): void {
		super.render();
		this._outputView = new OutputArea({
			rendermime: this.model.widget_manager.rendermime,
			contentFactory: OutputArea.defaultContentFactory,
			model: this.model.outputs,
		});
		// TODO: why is this a readonly property now?
		// this._outputView.model = this.model.outputs;
		// TODO: why is this on the model now?
		// this._outputView.trusted = true;
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
