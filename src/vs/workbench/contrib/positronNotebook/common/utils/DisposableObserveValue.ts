/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { IObservable, IObserver } from 'vs/base/common/observableInternal/base';


/**
 * A disposable that can be used to listen to an observable value.
 *
 */
export class DisposableObserveValue extends Disposable {

	private _observer: IObserver;

	/**
	 *
	 * @param _observableValue An observable value to listen to
	 * @param observerCallbacks Observer callbacks of type `IObserver` or a function to call when
	 * the value changes (equivalent to setting `handleChange` on the observer callbacks)
	 */
	constructor(
		private _observableValue: IObservable<any>,
		observerCallbacks: Partial<IObserver> | (() => void)
	) {
		super();
		if (typeof observerCallbacks === 'function') {
			observerCallbacks = { handleChange: observerCallbacks };
		}
		this._observer = {
			handleChange() { },
			beginUpdate() { },
			endUpdate() { },
			handlePossibleChange() { },
			...observerCallbacks
		};
		this._observableValue.addObserver(this._observer);
	}

	override dispose() {
		this._observableValue.removeObserver(this._observer);
		super.dispose();
	}
}
