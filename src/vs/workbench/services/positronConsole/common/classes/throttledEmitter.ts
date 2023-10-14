/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';

/**
 * ThrottledEmitter class.
 */
export class ThrottledEmitter<T> extends Emitter<T> {
	//#region Private Properties

	/**
	 * Gets or sets the throttle threshold.
	 */
	private readonly _throttleThreshhold: number;

	/**
	 * Gets or sets the throttle interval.
	 */
	private readonly _throttleInterval: number;

	/**
	 * Gets or sets the throttle event timeout.
	 */
	private _throttleEventTimeout?: NodeJS.Timeout;

	/**
	 * Gets or sets the throttle history.
	 */
	private _throttleHistory: number[] = [];

	/**
	 * Gets or sets the last event.
	 */
	private _lastEvent?: T;

	//#endregion Private Properties

	//#region Constructor & Dispose

	/**
	 * Constructor.
	 * @param throttleThreshhold The number of events to throttle at.
	 * @param throttleMs The throttle
	 */
	constructor(throttleThreshhold: number, throttleInterval: number) {
		super();
		this._throttleThreshhold = throttleThreshhold;
		this._throttleInterval = throttleInterval;
	}

	/**
	 * Dispose.
	 */
	override dispose() {
		// Clear the throttle event timeout.
		if (this._throttleEventTimeout) {
			clearTimeout(this._throttleEventTimeout);
			this._throttleEventTimeout = undefined;
		}

		// Dispose.
		super.dispose();
	}

	//#endregion Constructor & Dispose

	//#region Public Methods

	/**
	 * Fires the event.
	 */
	public override fire(event: T) {
		// Update the throttle history.
		const now = Date.now();
		const cutoff = now - this._throttleInterval;
		this._throttleHistory = this._throttleHistory.filter(time => time >= cutoff);
		this._throttleHistory.push(now);

		// If the event is being throttled, set the last event and return.
		if (this._throttleEventTimeout) {
			this._lastEvent = event;
			return;
		}

		// If the event can be fired immediately, fire it.
		if (this._throttleHistory.length < this._throttleThreshhold) {
			super.fire(event);
			return;
		}

		// Set the last event and schedule the throttle event timeout.
		this._lastEvent = event;
		this._throttleEventTimeout = setTimeout(() => {
			this._throttleEventTimeout = undefined;
			super.fire(this._lastEvent!);
		}, this._throttleInterval);
	}

	//#endregion Public Methods
}
