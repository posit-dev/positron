/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { DataExplorerBackendRequest, DataExplorerFrontendEvent, SearchSchemaSortOrder } from '../../../languageRuntime/common/positronDataExplorerComm.js';
import { IDataExplorerRpcDto, IDataExplorerResponseDto, IDataExplorerRpcTransport, IDataExplorerUiEventDto } from '../../common/dataExplorerRpcTransport.js';
import { PositronDataExplorerExtensionBackend } from '../../common/positronDataExplorerExtensionBackend.js';

describe('PositronDataExplorerExtensionBackend', () => {
	const PROVIDER_ID = 'positron-data-driver-sqlite';
	const IDENTIFIER = 'sqlite:1:table:people';
	let store: DisposableStore;

	beforeEach(() => {
		ensureNoLeakedDisposables();
		store = new DisposableStore();
	});

	afterEach(() => {
		store.dispose();
	});

	/** Builds a backend over a fake transport that responds with `respond(rpc)`. */
	function createBackend(respond: (rpc: IDataExplorerRpcDto) => IDataExplorerResponseDto) {
		const calls: Array<{ providerId: string; rpc: IDataExplorerRpcDto }> = [];
		const transport: IDataExplorerRpcTransport = {
			handleRpc: (providerId, rpc) => {
				calls.push({ providerId, rpc });
				return Promise.resolve(respond(rpc));
			}
		};
		const backend = store.add(new PositronDataExplorerExtensionBackend(transport, PROVIDER_ID, IDENTIFIER));
		return { backend, calls };
	}

	it('forwards an RPC tagged with the provider id and dataset identifier and unwraps the result', async () => {
		const { backend, calls } = createBackend(() => ({ result: { matches: [3, 1] } }));

		const result = await backend.searchSchema([], SearchSchemaSortOrder.AscendingName);

		expect({ calls, result }).toEqual({
			calls: [{
				providerId: PROVIDER_ID,
				rpc: {
					method: DataExplorerBackendRequest.SearchSchema,
					uri: IDENTIFIER,
					params: { filters: [], sort_order: SearchSchemaSortOrder.AscendingName },
				},
			}],
			result: { matches: [3, 1] },
		});
	});

	it('rejects when the transport returns an error message', async () => {
		const { backend } = createBackend(() => ({ error_message: 'boom' }));
		await expect(backend.getState()).rejects.toThrow('boom');
	});

	it('routes column-profile UI events to the onDidReturnColumnProfiles emitter', () => {
		const { backend } = createBackend(() => ({ result: undefined }));
		const event: IDataExplorerUiEventDto = {
			uri: IDENTIFIER,
			method: DataExplorerFrontendEvent.ReturnColumnProfiles,
			params: { callback_id: 'cb', profiles: [] },
		};

		let delivered: unknown;
		store.add(backend.onDidReturnColumnProfiles(e => { delivered = e; }));
		backend.handleUiEvent(event);

		expect(delivered).toEqual({ callback_id: 'cb', profiles: [] });
	});
});
