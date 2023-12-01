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
	 * True if this widget has a `layout` property.
	 */
	private hasLayout(): boolean {
		return this.state.get('layout') !== undefined;
	}

	/**
	 * True if this widget has a `dom_classes` property.
	 */
	private hasDomClasses(): boolean {
		return this.state.get('dom_classes') !== undefined;
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
		const stateValues = this.state.values();
		const dependencies: string[] = [];
		stateValues.forEach((value: any) => {
			if (typeof value === 'string' && value.startsWith('IPY_MODEL_')) {
				dependencies.push(value.substring('IPY_MODEL_'.length));
			}
		});
		return dependencies;
	}

	get state(): any {
		return this.metadata.widget_state.state;
	}

	/**
	 * Returns the widget's unique ID.
	 */
	get id(): string {
		return this.metadata.id;
	}
}
