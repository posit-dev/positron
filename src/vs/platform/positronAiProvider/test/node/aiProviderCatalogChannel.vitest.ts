/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Emitter } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { IAiProviderCatalog, IProviderCatalogChangeData, IResolvedProviderData } from '../../common/aiProviderCatalog.js';
import { AiProviderCatalogChannel } from '../../node/aiProviderCatalogChannel.js';

const providers: IResolvedProviderData[] = [
	{ id: 'anthropic', enabled: true, connection: {} },
];

const change: IProviderCatalogChangeData = {
	catalog: providers,
	enabledChanged: true,
	connectionChanged: false,
	modelsChanged: false,
};

function fakeCatalog(overrides: Partial<IAiProviderCatalog> = {}): IAiProviderCatalog {
	return {
		onDidChangeCatalog: new Emitter<IProviderCatalogChangeData>().event,
		getCatalog: async () => providers,
		getConfigFileUri: async () => URI.file('/tmp/providers.json'),
		...overrides,
	};
}

describe('AiProviderCatalogChannel', () => {
	it('routes getCatalog to the catalog', async () => {
		const channel = new AiProviderCatalogChannel(fakeCatalog());
		expect(await channel.call(null, 'getCatalog')).toEqual(providers);
	});

	it('routes getConfigFileUri to the catalog', async () => {
		const channel = new AiProviderCatalogChannel(fakeCatalog());
		expect(await channel.call(null, 'getConfigFileUri')).toEqual(URI.file('/tmp/providers.json'));
	});

	it('relays onDidChangeCatalog events', async () => {
		const emitter = new Emitter<IProviderCatalogChangeData>();
		const channel = new AiProviderCatalogChannel(fakeCatalog({ onDidChangeCatalog: emitter.event }));
		const received = new Promise<IProviderCatalogChangeData>(resolve => {
			channel.listen(null, 'onDidChangeCatalog')(resolve as (e: unknown) => void);
		});
		emitter.fire(change);
		expect(await received).toEqual(change);
	});

	it('throws on an unknown call or listen', () => {
		const channel = new AiProviderCatalogChannel(fakeCatalog());
		expect(() => channel.call(null, 'nope')).toThrow('Unknown command: nope');
		expect(() => channel.listen(null, 'nope')).toThrow('Unknown event: nope');
	});
});
