/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { delay } from './util';

// Used to yield periodically to the event loop
const YIELD_THRESHOLD = 100;

/**
 * Multi-consumer multi-producer channel.
 * - Used as an async iterator. Dispose to close.
 * - All endpoints can close. All are closed at the same time.
 * - Sending a value to a closed channel is an error.
 */
export class Channel<T> implements AsyncIterable<T>, AsyncIterator<T>, vscode.Disposable {
	private closed = false;
	private queue: T[] = [];
	private pending_consumers: ((value: IteratorResult<T>) => void)[] = [];
	private i = 0;
	private disposables: vscode.Disposable[] = [];
	private isDisposed = false;

	send(value: T) {
		if (this.closed) {
			throw new Error('Can\'t send values after channel is closed');
		}

		if (this.pending_consumers.length > 0) {
			// There is a consumer waiting, resolve it immediately
			this.pending_consumers.shift()!({ value, done: false });
		} else {
			// No consumer waiting, queue up the value
			this.queue.push(value);
		}
	}

	private close() {
		this.closed = true;

		// Resolve all pending consumers as done
		while (this.pending_consumers.length > 0) {
			this.pending_consumers.shift()!({ value: undefined, done: true });
		}
	}

  dispose() {
   // Since channel is owned by multiple endpoints we need to be careful about
   // `dispose()` being idempotent
  	if (this.isDisposed) {
			return;
   	}
		this.isDisposed = true;

		this.close();
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
  }

	register(disposable: vscode.Disposable) {
		this.disposables.push(disposable);
	}

	[Symbol.asyncIterator]() {
		return this;
	}

	async next(): Promise<IteratorResult<T>> {
		if (this.queue.length > 0) {
			++this.i;

			// Yield regularly to event loop to avoid starvation. Sends are
			// synchronous and handlers might be synchronous as well.
			if (this.i > YIELD_THRESHOLD) {
				this.i = 0;
				await delay(0);
			}

			return { value: this.queue.shift()!, done: false };
		}

		// If nothing in the queue and the channel is closed, we're done
		if (this.closed) {
			return { value: undefined, done: true };
		}

		// Nothing in the queue, wait for a value to be sent
		return new Promise<IteratorResult<T>>((resolve) => {
			this.pending_consumers.push(resolve);
		});
	}
}
