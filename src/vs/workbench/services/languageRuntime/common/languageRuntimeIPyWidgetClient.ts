/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { IRuntimeClientInstance } from 'vs/workbench/services/languageRuntime/common/languageRuntimeClientInstance';
import { IPositronIPyWidgetClient, IPositronIPyWidgetMetadata } from 'vs/workbench/services/positronIPyWidgets/common/positronIPyWidgetsService';

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
		// TODO: define these input/output types
		private readonly _client: IRuntimeClientInstance<any, any>,
		public metadata: IPositronIPyWidgetMetadata) {

		super();
		this._register(this._client);
		// Connect close emitter event
		this.onDidClose = this._closeEmitter.event;
	}

	/**
	 * Returns the widget's unique ID.
	 */
	get id(): string {
		return this.metadata.id;
	}
}
