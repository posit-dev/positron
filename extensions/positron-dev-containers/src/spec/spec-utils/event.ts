/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EventEmitter } from 'events';

export interface Event<T> {
	(listener: (e: T) => void): Disposable;
}

export class NodeEventEmitter<T> {

	private nodeEmitter = new EventEmitter();

	constructor(private register?: { on: () => void; off: () => void }) { }
	event: Event<T> = (listener: (e: T) => void): Disposable => {
		this.nodeEmitter.on('event', listener);
		if (this.register && this.nodeEmitter.listenerCount('event') === 1) {
			this.register.on();
		}
		return {
			dispose: () => {
				if (this.register && this.nodeEmitter.listenerCount('event') === 1) {
					this.register.off();
				}
				this.nodeEmitter.off('event', listener);
			}
		};
	};

	fire(data: T) {
		this.nodeEmitter.emit('event', data);
	}
	dispose() {
		this.nodeEmitter.removeAllListeners();
	}
}

export interface Disposable {
	dispose(): void;
}
