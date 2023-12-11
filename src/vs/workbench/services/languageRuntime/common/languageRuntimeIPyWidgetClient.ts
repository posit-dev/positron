/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { IRuntimeClientInstance, RuntimeClientState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeClientInstance';
import { IPositronIPyWidgetClient, IPositronIPyWidgetMetadata } from 'vs/workbench/services/positronIPyWidgets/common/positronIPyWidgetsService';

/**
 * The possible types of messages that can be sent to the language runtime from the widget frontend.
 * These are defined by ipywidgets (protocol version 2), we just inherit them.
 * https://github.com/jupyter-widgets/ipywidgets/blob/52663ac472c38ba12575dfb4979fa2d250e79bc3/packages/schema/messages.md#state-synchronization-1
 */
export enum IPyWidgetClientMessageTypeInput {
	/** When a widget's state changes in the frontend, notify the kernel */
	Update = 'update',

	/** When a frontend wants to request the full state of a widget from the kernel */
	RequestState = 'request_state',
}

/**
 * The possible types of messages that can be sent from the language runtime to the widget frontend.
 * This does not include the comm_open message, which is handled separately.
 * These are defined by ipywidgets (protocol version 2), we just inherit them.
 * https://github.com/jupyter-widgets/ipywidgets/blob/52663ac472c38ba12575dfb4979fa2d250e79bc3/packages/schema/messages.md#state-synchronization-1
 */
export enum IPyWidgetClientMessageTypeOutput {
	/** When a widget's state changes in the kernel, notify the frontend */
	Update = 'update',
}

/**
 * A message used to send data to the language runtime plot client.
 */
export interface IPyWidgetClientMessageInput {
	msg_type: IPyWidgetClientMessageTypeInput;
}

/**
 * A message used to receive data from the language runtime plot client.
 */
export interface IPyWidgetClientMessageOutput {
	msg_type: IPyWidgetClientMessageTypeOutput;
}


/**
 * An IPyWidget client instance.
 */
export class IPyWidgetClientInstance extends Disposable implements IPositronIPyWidgetClient {

	/**
	 * Event that fires when the widget is closed on the runtime side
	 */
	onDidClose: Event<void>;
	private readonly _closeEmitter = new Emitter<void>();

	/** Creates the IPyWidget client instance */
	constructor(
		private readonly _client: IRuntimeClientInstance<IPyWidgetClientMessageInput, IPyWidgetClientMessageOutput>,
		public metadata: IPositronIPyWidgetMetadata) {

		super();
		// Connect close emitter event
		this.onDidClose = this._closeEmitter.event;
		_client.onDidChangeClientState((state) => {
			if (state === RuntimeClientState.Closed) {
				this._closeEmitter.fire();
			}
		});
		this._register(this._client);
	}

	/**
	 * True if this widget has a `layout` property.
	 */
	private hasLayout(): boolean {
		return 'layout' in this.state;
	}

	/**
	 * True if this widget has a `_dom_classes` property.
	 */
	private hasDomClasses(): boolean {
		return '_dom_classes' in this.state;
	}

	/**
	 * True if this widget is possibly a viewable main widget.
	 * At minimum, it must have a `layout` property and a `dom_classes` property.
	 */
	public isViewable(): boolean {
		return this.hasLayout() && this.hasDomClasses();
	}

	/**
	 * Returns a list of IDs of widgets that this widget depends on.
	 */
	get dependencies(): string[] {

		const stateValues = Object.values(this.state);
		const dependencies: string[] = [];
		stateValues.forEach((value: any) => {
			if (typeof value === 'string' && value.startsWith('IPY_MODEL_')) {
				dependencies.push(value.substring('IPY_MODEL_'.length));
			}
		});
		return dependencies;
	}

	get state() {
		return this.metadata.widget_state.state;
	}

	/**
	 * Returns the widget's unique ID.
	 */
	get id(): string {
		return this.metadata.id;
	}
}
