/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import type * as positron from 'positron';

import { Emitter } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import * as extHostProtocol from './extHost.positron.protocol.js';

class ExtHostEditReviewSession implements positron.ai.EditReviewSession {

	private readonly _onDidChangeEntries = new Emitter<readonly positron.ai.EditReviewEntry[]>();
	readonly onDidChangeEntries = this._onDidChangeEntries.event;
	entries: readonly positron.ai.EditReviewEntry[] = [];

	/** Settles once the main thread has the session; calls made before then wait for it. */
	private readonly _created: Promise<void>;

	constructor(
		private readonly _proxy: extHostProtocol.MainThreadEditReviewShape,
		private readonly _handle: number,
		private readonly _onDidDispose: () => void,
	) {
		this._created = this._proxy.$createSession(_handle);
		// A failure is reported by the calls that wait for the session.
		this._created.catch(() => { });
	}

	acceptEntries(entries: extHostProtocol.IEditReviewEntryDto[]): void {
		this.entries = entries.map(entry => ({ uri: URI.revive(entry.uri), state: entry.state }));
		this._onDidChangeEntries.fire(this.entries);
	}

	async trackEdits<T>(resources: readonly vscode.Uri[], callback: () => Thenable<T>): Promise<T> {
		await this._created;
		const operationId = await this._proxy.$startEdits(this._handle, [...resources]);
		try {
			return await callback();
		} finally {
			await this._proxy.$stopEdits(this._handle, operationId);
		}
	}

	async keep(resources?: readonly vscode.Uri[]): Promise<void> {
		await this._created;
		await this._proxy.$keep(this._handle, resources && [...resources]);
	}

	async undo(resources?: readonly vscode.Uri[]): Promise<void> {
		await this._created;
		await this._proxy.$undo(this._handle, resources && [...resources]);
	}

	async show(): Promise<void> {
		await this._created;
		await this._proxy.$show(this._handle);
	}

	dispose(): void {
		this._onDidDispose();
		this._onDidChangeEntries.dispose();
		this._created.then(() => this._proxy.$disposeSession(this._handle), () => { });
	}
}

export class ExtHostEditReview implements extHostProtocol.ExtHostEditReviewShape {

	private readonly _proxy: extHostProtocol.MainThreadEditReviewShape;
	private readonly _sessions = new Map<number, ExtHostEditReviewSession>();
	private _nextHandle = 0;

	constructor(mainContext: extHostProtocol.IMainPositronContext) {
		this._proxy = mainContext.getProxy(extHostProtocol.MainPositronContext.MainThreadEditReview);
	}

	createSession(): positron.ai.EditReviewSession {
		const handle = this._nextHandle++;
		const session = new ExtHostEditReviewSession(this._proxy, handle, () => this._sessions.delete(handle));
		this._sessions.set(handle, session);
		return session;
	}

	$onDidChangeEntries(handle: number, entries: extHostProtocol.IEditReviewEntryDto[]): void {
		this._sessions.get(handle)?.acceptEntries(entries);
	}
}
