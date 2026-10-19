/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { ensureNoLeakedDisposables } from '../../../../../test/vitest/vitestUtils.js';
import { IDataExplorerRpcTransport } from '../../../positronDataExplorer/common/dataExplorerRpcTransport.js';
import { PositronDataExplorerExtensionBackend } from '../../../positronDataExplorer/common/positronDataExplorerExtensionBackend.js';
import { DataExplorerClientInstance } from '../../common/languageRuntimeDataExplorerClient.js';

describe('DataExplorerClientInstance', () => {
	let store: DisposableStore;

	beforeEach(() => {
		ensureNoLeakedDisposables();
		store = new DisposableStore();
	});

	afterEach(() => {
		store.dispose();
	});

	it('delivers its close event to every listener when a listener disposes the client again', () => {
		const transport: IDataExplorerRpcTransport = {
			handleRpc: async () => ({ result: undefined }),
			disposeBackend: () => { },
		};
		const client = store.add(new DataExplorerClientInstance(
			new PositronDataExplorerExtensionBackend(transport, 'provider', 'dataset')
		));

		// The first listener disposes the client again, as disposing the Data Explorer instance that
		// owns the client does.
		const received: string[] = [];
		store.add(client.onDidClose(() => {
			received.push('first');
			client.dispose();
		}));
		store.add(client.onDidClose(() => received.push('second')));

		client.dispose();

		expect(received).toEqual(['first', 'second']);
	});
});
