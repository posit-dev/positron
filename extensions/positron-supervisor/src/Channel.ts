/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { delay } from './util';

// Used to yield periodically to the event loop
const YIELD_THRESHOLD = 100;

/**
 * Creates a new channel and returns both sender and receiver.
 * Either can be used to close the channel by calling `dispose()`.
 */
export function channel<T>(): [Sender<T>, Receiver<T>] {
	const state = new ChannelState<T>();
	const sender = new Sender(state);
	const receiver = new Receiver(state);
	return [sender, receiver];
}

/**
 * Channel sender (tx). synchronously sends values to the channel.
 */
export class Sender<T> implements vscode.Disposable {
	private disposables: vscode.Disposable[] = [];

	constructor(private state: ChannelState<T>) {}

	send(value: T) {
		if (this.state.closed) {
			throw new Error('Can\'t send values after channel is closed');
		}

		if (this.state.pending_consumers.length > 0) {
			// There is a consumer waiting, resolve it immediately
			this.state.pending_consumers.shift()!({ value, done: false });
		} else {
			// No consumer waiting, queue up the value
			this.state.queue.push(value);
		}
	}

	dispose() {
		this.state.dispose();
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
	}

	register(disposable: vscode.Disposable) {
		this.disposables.push(disposable);
	}
}

/**
 * Channel receiver (rx). Async-iterable to receive values from the channel.
 */
export class Receiver<T> implements AsyncIterable<T>, AsyncIterator<T>, vscode.Disposable {
	private i = 0;
	private disposables: vscode.Disposable[] = [];

	constructor(private state: ChannelState<T>) {}

	[Symbol.asyncIterator]() {
		return this;
	}

	async next(): Promise<IteratorResult<T>> {
		if (this.state.queue.length > 0) {
			++this.i;

			// Yield regularly to event loop to avoid starvation. Sends are
			// synchronous and handlers might be synchronous as well.
			if (this.i > YIELD_THRESHOLD) {
				this.i = 0;
				await delay(0);
			}

			return { value: this.state.queue.shift()!, done: false };
		}

		// If nothing in the queue and the channel is closed, we're done
		if (this.state.closed) {
			return { value: undefined, done: true };
		}

		// Nothing in the queue, wait for a value to be sent
		return new Promise<IteratorResult<T>>((resolve) => {
			this.state.pending_consumers.push(resolve);
		});
	}

	dispose() {
		this.state.dispose();
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
	}

	register(disposable: vscode.Disposable) {
		this.disposables.push(disposable);
	}
}

/**
 * Shared state between sender and receiver
 */
class ChannelState<T> {
	closed = false;
	queue: T[] = [];
	pending_consumers: ((value: IteratorResult<T>) => void)[] = [];

	dispose() {
		// Since channel is owned by multiple endpoints we need to be careful about
		// `dispose()` being idempotent
		if (this.closed) {
			return;
		}
		this.closed = true;

		// Resolve all pending consumers as done
		while (this.pending_consumers.length > 0) {
			this.pending_consumers.shift()!({ value: undefined, done: true });
		}
	}
}
