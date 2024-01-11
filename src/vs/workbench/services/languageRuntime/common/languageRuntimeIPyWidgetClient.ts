/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { IRuntimeClientInstance, RuntimeClientState } from 'vs/workbench/services/languageRuntime/common/languageRuntimeClientInstance';
import { IPositronIPyWidgetClient, IPositronIPyWidgetMetadata } from 'vs/workbench/services/positronIPyWidgets/common/positronIPyWidgetsService';

/**
 * The possible types of messages that can be sent from the widget frontend to the language runtime.
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
 * These are defined by ipywidgets (protocol version 2), we just inherit them, with the exception of
 * 'display', which is converted into a comm message from the 'display_data' IOpub-style message.
 * https://github.com/jupyter-widgets/ipywidgets/blob/52663ac472c38ba12575dfb4979fa2d250e79bc3/packages/schema/messages.md#state-synchronization-1
 */
export enum IPyWidgetClientMessageTypeOutput {
	/** When a widget's state changes in the kernel, notify the frontend */
	Update = 'update',

	/** When a kernel is ready to display the widget in the UI, notify the frontend */
	Display = 'display',
}

/**
 * A message used to deliver data from the frontend to the backend.
 */
export interface IPyWidgetClientMessageInput {
	msg_type: IPyWidgetClientMessageTypeInput;
}

/**
 * A message used to deliver data from the backend to the frontend.
 */
export interface IPyWidgetClientMessageOutput {
	msg_type: IPyWidgetClientMessageTypeOutput;
}

export interface DisplayWidgetEvent {
	/** An array containing the IDs of widgets to be included in the view. */
	view_ids: string[];
}

/**
 * A message requesting a widget be displayed in the Plots pane.
 */
export interface IPyWidgetClientMessageDisplay
	extends IPyWidgetClientMessageOutput, DisplayWidgetEvent {
}

/**
 * An IPyWidget client instance.
 */
export class IPyWidgetClientInstance extends Disposable implements IPositronIPyWidgetClient {

	/** Event that fires when the widget is closed on the runtime side. */
	private readonly _onDidClose = new Emitter<void>();
	readonly onDidClose: Event<void> = this._onDidClose.event;

	private readonly _onDidDispose = new Emitter<void>();
	readonly onDidDispose: Event<void> = this._onDidDispose.event;

	/** The emitter for runtime client events. */
	private readonly _onDidEmitDisplay = this._register(new Emitter<DisplayWidgetEvent>());
	readonly onDidEmitDisplay: Event<DisplayWidgetEvent>;

	/** Creates the IPyWidget client instance */
	constructor(
		private readonly _client: IRuntimeClientInstance<IPyWidgetClientMessageInput, IPyWidgetClientMessageOutput>,
		public metadata: IPositronIPyWidgetMetadata) {

		super();
		_client.onDidChangeClientState((state) => {
			if (state === RuntimeClientState.Closed) {
				this._onDidClose.fire();
			}
		});
		this._register(this._client);

		this._register(this._client.onDidReceiveData(data => this.handleData(data)));

		this.onDidEmitDisplay = this._onDidEmitDisplay.event;
		this.onDidClose = this._onDidClose.event;
	}

	/**
	 * Handles data received from the backend.
	 *
	 * @param data Data received from the backend.
	 */
	private handleData(data: IPyWidgetClientMessageOutput): void {
		switch (data.msg_type) {
			case IPyWidgetClientMessageTypeOutput.Display:
				this._onDidEmitDisplay.fire(data as IPyWidgetClientMessageDisplay);
				break;
		}
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

	override dispose(): void {
		super.dispose();
		this._onDidDispose.fire();
	}
}
