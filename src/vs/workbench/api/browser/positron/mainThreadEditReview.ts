/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableMap, DisposableStore } from '../../../../base/common/lifecycle.js';
import { URI, UriComponents } from '../../../../base/common/uri.js';
import { IPositronEditReviewService, IPositronEditReviewSession } from '../../../contrib/positronAssistant/common/positronEditReview.js';
import { extHostNamedCustomer, IExtHostContext } from '../../../services/extensions/common/extHostCustomers.js';
import { ExtHostEditReviewShape, ExtHostPositronContext, MainPositronContext, MainThreadEditReviewShape } from '../../common/positron/extHost.positron.protocol.js';

@extHostNamedCustomer(MainPositronContext.MainThreadEditReview)
export class MainThreadEditReview extends Disposable implements MainThreadEditReviewShape {

	private readonly _proxy: ExtHostEditReviewShape;

	/** Sessions by handle. Disposed with the extension host, which ends their edits in progress. */
	private readonly _sessions = new Map<number, IPositronEditReviewSession>();
	private readonly _sessionDisposables = this._register(new DisposableMap<number>());

	constructor(
		extHostContext: IExtHostContext,
		@IPositronEditReviewService private readonly _editReviewService: IPositronEditReviewService,
	) {
		super();
		this._proxy = extHostContext.getProxy(ExtHostPositronContext.ExtHostEditReview);
	}

	async $createSession(handle: number): Promise<void> {
		const session = this._editReviewService.createSession();
		const disposables = new DisposableStore();
		disposables.add(session);
		disposables.add(session.onDidChangeEntries(entries => this._proxy.$onDidChangeEntries(handle, [...entries])));
		disposables.add({ dispose: () => this._sessions.delete(handle) });
		this._sessions.set(handle, session);
		this._sessionDisposables.set(handle, disposables);
	}

	async $startEdits(handle: number, resources: UriComponents[]): Promise<number> {
		return this._session(handle).startEdits(resources.map(resource => URI.revive(resource)));
	}

	async $stopEdits(handle: number, operationId: number): Promise<void> {
		await this._sessions.get(handle)?.stopEdits(operationId);
	}

	async $keep(handle: number, resources: UriComponents[] | undefined): Promise<void> {
		await this._session(handle).keep(resources?.map(resource => URI.revive(resource)));
	}

	async $undo(handle: number, resources: UriComponents[] | undefined): Promise<void> {
		await this._session(handle).undo(resources?.map(resource => URI.revive(resource)));
	}

	async $show(handle: number): Promise<void> {
		await this._session(handle).show();
	}

	$disposeSession(handle: number): void {
		this._sessionDisposables.deleteAndDispose(handle);
	}

	private _session(handle: number): IPositronEditReviewSession {
		const session = this._sessions.get(handle);
		if (!session) {
			throw new Error('The edit review session is disposed');
		}
		return session;
	}
}
