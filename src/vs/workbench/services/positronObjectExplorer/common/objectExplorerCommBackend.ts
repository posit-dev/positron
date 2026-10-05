/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IRuntimeClientInstance } from '../../languageRuntime/common/languageRuntimeClientInstance.js';
import { ObjectExplorerBackendRequest, PositronObjectExplorerComm } from '../../languageRuntime/common/positronObjectExplorerComm.js';
import { ChildrenResult, FormattedValue, IObjectExplorerBackend, ObjectExplorerState, ObjectNode, SearchResult } from './objectExplorerBackend.js';

/**
 * Timeout for RPCs that may walk a large part of the object.
 */
const LONG_RPC_TIMEOUT = 60_000;

/**
 * An object explorer backend served by a language runtime over the object explorer comm.
 */
export class ObjectExplorerCommBackend extends Disposable implements IObjectExplorerBackend {
	private readonly _comm: PositronObjectExplorerComm;

	readonly onDidUpdate: Event<void>;
	readonly onDidClose: Event<void>;

	/**
	 * Constructor.
	 * @param client The runtime client instance for the comm. The backend takes ownership of it;
	 * disposing the backend closes the comm.
	 */
	constructor(client: IRuntimeClientInstance<unknown, unknown>) {
		super();
		this._comm = this._register(new PositronObjectExplorerComm(client, {
			[ObjectExplorerBackendRequest.Search]: { timeout: LONG_RPC_TIMEOUT },
			[ObjectExplorerBackendRequest.FormatValue]: { timeout: LONG_RPC_TIMEOUT },
		}));
		this.onDidUpdate = Event.map(this._comm.onDidUpdate, () => undefined);
		this.onDidClose = this._comm.onDidClose;
	}

	get identifier(): string {
		return this._comm.clientId;
	}

	getState(): Promise<ObjectExplorerState> {
		return this._comm.getState();
	}

	getRoot(): Promise<ObjectNode> {
		return this._comm.getRoot();
	}

	getChildren(path: string[], start: number, limit: number): Promise<ChildrenResult> {
		return this._comm.getChildren(path, start, limit);
	}

	search(query: string, maxDepth: number, maxResults: number): Promise<SearchResult> {
		return this._comm.search(query, maxDepth, maxResults);
	}

	formatValue(path: string[], maxLength?: number): Promise<FormattedValue> {
		return this._comm.formatValue(path, maxLength);
	}

	openObjectExplorer(): Promise<string> {
		return this._comm.openObjectExplorer();
	}
}
