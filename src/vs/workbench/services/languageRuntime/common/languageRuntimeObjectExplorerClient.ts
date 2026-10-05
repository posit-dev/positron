/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ChildrenResult, FormattedValue, IObjectExplorerBackend, ObjectExplorerState, ObjectNode, SearchResult } from '../../positronObjectExplorer/common/objectExplorerBackend.js';

/**
 * The status of an object explorer client.
 */
export type ObjectExplorerClientStatus = 'idle' | 'computing' | 'disconnected' | 'error';

/**
 * Wraps an object explorer backend, tracking whether requests are in flight and whether the
 * backend is still connected.
 */
export class ObjectExplorerClientInstance extends Disposable {
	private _status: ObjectExplorerClientStatus = 'idle';
	private _errorMessage: string | undefined;
	private _numPendingTasks = 0;
	private _cachedState: ObjectExplorerState | undefined;

	private readonly _onDidStatusUpdateEmitter = this._register(new Emitter<ObjectExplorerClientStatus>());

	// Not registered, so that it can fire while the client is being disposed.
	private readonly _onDidCloseEmitter = new Emitter<void>();

	readonly onDidStatusUpdate = this._onDidStatusUpdateEmitter.event;
	readonly onDidClose = this._onDidCloseEmitter.event;
	readonly onDidUpdate: Event<void>;

	/**
	 * Constructor.
	 * @param _backend The backend. The client takes ownership of it.
	 */
	constructor(private readonly _backend: IObjectExplorerBackend) {
		super();
		this._register(this._backend);
		this.onDidUpdate = this._backend.onDidUpdate;
		this._register(this._backend.onDidClose(() => {
			this.setStatus('disconnected');
			this._onDidCloseEmitter.fire();
		}));
	}

	override dispose(): void {
		super.dispose();
		this._onDidCloseEmitter.dispose();
	}

	get identifier(): string {
		return this._backend.identifier;
	}

	get status(): ObjectExplorerClientStatus {
		return this._status;
	}

	/**
	 * The message describing the current error, when the status is 'error'.
	 */
	get errorMessage(): string | undefined {
		return this._errorMessage;
	}

	/**
	 * The state returned by the most recent getState call.
	 */
	get cachedState(): ObjectExplorerState | undefined {
		return this._cachedState;
	}

	/**
	 * Whether the backend can open a full object explorer on the same object.
	 */
	get canOpenObjectExplorer(): boolean {
		return this._backend.openObjectExplorer !== undefined;
	}

	/**
	 * Puts the client in the error state until the next request completes, or clears the error
	 * when no message is given.
	 * @param message The error message.
	 */
	setError(message: string | undefined): void {
		this._errorMessage = message;
		if (this._status === 'disconnected') {
			return;
		}
		if (message !== undefined) {
			this.setStatus('error');
		} else if (this._status === 'error') {
			this.setStatus(this._numPendingTasks > 0 ? 'computing' : 'idle');
		}
	}

	async getState(): Promise<ObjectExplorerState> {
		this._cachedState = await this.runBackendTask(() => this._backend.getState());
		return this._cachedState;
	}

	getRoot(): Promise<ObjectNode> {
		return this.runBackendTask(() => this._backend.getRoot());
	}

	getChildren(path: string[], start: number, limit: number): Promise<ChildrenResult> {
		return this.runBackendTask(() => this._backend.getChildren(path, start, limit));
	}

	search(query: string, maxDepth: number, maxResults: number): Promise<SearchResult> {
		return this.runBackendTask(() => this._backend.search(query, maxDepth, maxResults));
	}

	formatValue(path: string[], maxLength?: number): Promise<FormattedValue> {
		return this.runBackendTask(() => this._backend.formatValue(path, maxLength));
	}

	openObjectExplorer(): Promise<string> {
		return this.runBackendTask(() => {
			if (!this._backend.openObjectExplorer) {
				throw new Error('The backend cannot open an object explorer.');
			}
			return this._backend.openObjectExplorer();
		});
	}

	/**
	 * Runs a backend request, reporting 'computing' while any request is in flight.
	 */
	private async runBackendTask<T>(task: () => Promise<T>): Promise<T> {
		if (this.isDisconnected()) {
			throw new Error(localize('positron.objectExplorer.disconnected', "The object is no longer available."));
		}
		this._numPendingTasks++;
		if (this._status !== 'error') {
			this.setStatus('computing');
		}
		try {
			return await task();
		} finally {
			this._numPendingTasks--;
			// The backend may have closed while the request was in flight.
			if (this._numPendingTasks === 0 && !this.isDisconnected() && this._status !== 'error') {
				this.setStatus('idle');
			}
		}
	}

	/**
	 * A method rather than an inline comparison so that the check after an await is not narrowed
	 * away by the check before it.
	 */
	private isDisconnected(): boolean {
		return this._status === 'disconnected';
	}

	private setStatus(status: ObjectExplorerClientStatus): void {
		if (status !== this._status) {
			this._status = status;
			this._onDidStatusUpdateEmitter.fire(status);
		}
	}
}
