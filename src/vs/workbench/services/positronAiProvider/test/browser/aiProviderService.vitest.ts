/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Emitter } from '../../../../../base/common/event.js';
import { Schemas } from '../../../../../base/common/network.js';
import { URI } from '../../../../../base/common/uri.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { IAiProviderCatalog, IProviderCatalogChangeData, IResolvedProviderData } from '../../../../../platform/positronAiProvider/common/aiProviderCatalog.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { IWorkbenchEnvironmentService } from '../../../environment/common/environmentService.js';
import { IRemoteAgentService } from '../../../remote/common/remoteAgentService.js';
import { AbstractAiProviderService } from '../../browser/abstractAiProviderService.js';
import { BrowserAiProviderService } from '../../browser/aiProviderService.js';

function provider(id: string, enabled: boolean): IResolvedProviderData {
	return { id, enabled, connection: {} };
}

function change(catalog: readonly IResolvedProviderData[]): IProviderCatalogChangeData {
	return { catalog, enabledChanged: true, connectionChanged: false, modelsChanged: false };
}

/** A fake node-side catalog: an emitter for change events plus stubbed promises. */
function fakeCatalog(options: {
	catalog?: readonly IResolvedProviderData[];
	getCatalog?: () => Promise<readonly IResolvedProviderData[]>;
	configFilePath?: string;
} = {}): {
	catalog: IAiProviderCatalog;
	onDidChangeCatalog: Emitter<IProviderCatalogChangeData>;
	getCatalog: ReturnType<typeof vi.fn>;
	getConfigFileUri: ReturnType<typeof vi.fn>;
} {
	const onDidChangeCatalog = new Emitter<IProviderCatalogChangeData>();
	const getCatalog = vi.fn(options.getCatalog ?? (async () => options.catalog ?? []));
	const getConfigFileUri = vi.fn(async () => URI.file(options.configFilePath ?? '/home/user/providers.json'));
	return {
		catalog: { onDidChangeCatalog: onDidChangeCatalog.event, getCatalog, getConfigFileUri },
		onDidChangeCatalog,
		getCatalog,
		getConfigFileUri,
	};
}

// A test subclass that hands the base a fixed fake catalog and a fixed remote
// authority. Constructed directly (not via createInstance) so the test file
// avoids DI parameter decorators the vitest transformer cannot parse.
class TestAiProviderService extends AbstractAiProviderService {
	constructor(
		private readonly _fakeCatalog: IAiProviderCatalog | undefined,
		private readonly _remote: boolean,
		logService: ILogService,
	) {
		super(logService);
	}
	protected createCatalogClient(): IAiProviderCatalog | undefined {
		return this._fakeCatalog;
	}
	protected remoteAuthority(): string | undefined {
		return this._remote ? 'remote-host' : undefined;
	}
}

describe('AiProviderService', () => {
	// A single container carries both the plain-subclass stubs and the services
	// the DI-instantiation case needs. The channel stub's `listen` captures a
	// describe-level emitter so its reference is stable at build() time (builder
	// rule: emitters created inside it() would be a different object).
	const diChangeEmitter = new Emitter<IProviderCatalogChangeData>();
	const diChannel = {
		call: (command: string) => command === 'getCatalog'
			? Promise.resolve([provider('anthropic', true)])
			: Promise.resolve(URI.file('/home/user/providers.json').toJSON()),
		listen: () => diChangeEmitter.event,
	};
	const ctx = createTestContainer()
		.stub(ILogService, new NullLogService())
		.stub(IRemoteAgentService, { getConnection: () => ({ getChannel: () => diChannel }) })
		.stub(IWorkbenchEnvironmentService, { remoteAuthority: 'remote-host' })
		.build();

	function createService(catalog: IAiProviderCatalog | undefined, remote = false): TestAiProviderService {
		return ctx.disposables.add(new TestAiProviderService(catalog, remote, ctx.get(ILogService)));
	}

	it('snapshot is empty before initialization: getProvider undefined, isEnabled false', () => {
		const service = createService(fakeCatalog({ catalog: [provider('anthropic', true)] }).catalog);
		// Read synchronously before whenInitialized resolves.
		expect(service.status).toBe('initializing');
		expect(service.getProvider('anthropic')).toBeUndefined();
		expect(service.isEnabled('anthropic')).toBe(false);
		expect(service.getProviders()).toEqual([]);
	});

	it('whenInitialized resolves and status becomes ready after a successful fetch', async () => {
		const service = createService(fakeCatalog({ catalog: [provider('anthropic', true)] }).catalog);
		await service.whenInitialized;
		expect(service.status).toBe('ready');
		expect(service.lastError).toBeUndefined();
		expect(service.getProvider('anthropic')).toEqual(provider('anthropic', true));
	});

	it('isEnabled reflects the fetched catalog (enabled and disabled providers)', async () => {
		const service = createService(fakeCatalog({ catalog: [provider('anthropic', true), provider('openai', false)] }).catalog);
		await service.whenInitialized;
		expect(service.isEnabled('anthropic')).toBe(true);
		expect(service.isEnabled('openai')).toBe(false);
		expect(service.isEnabled('unknown')).toBe(false);
	});

	it('a catalog change event refreshes the snapshot BEFORE onDidChangeProviders fires', async () => {
		const fake = fakeCatalog({ catalog: [provider('anthropic', true)] });
		const service = createService(fake.catalog);
		await service.whenInitialized;

		const seen: IResolvedProviderData[] = [];
		ctx.disposables.add(service.onDidChangeProviders(() => {
			// The snapshot must already reflect the new catalog when the event fires.
			const openai = service.getProvider('openai');
			if (openai) {
				seen.push(openai);
			}
		}));

		fake.onDidChangeCatalog.fire(change([provider('anthropic', true), provider('openai', true)]));
		expect(seen).toEqual([provider('openai', true)]);
		expect(service.getProvider('openai')).toEqual(provider('openai', true));
	});

	it('a failed fetch: whenInitialized still resolves, status=error, lastError set, snapshot stays empty', async () => {
		const fake = fakeCatalog({ getCatalog: async () => { throw new Error('channel down'); } });
		const service = createService(fake.catalog);
		await service.whenInitialized;
		expect(service.status).toBe('error');
		expect(service.lastError?.message).toBe('channel down');
		expect(service.getProviders()).toEqual([]);
	});

	it('a catalog change event replaces the prior snapshot in place', async () => {
		const fake = fakeCatalog({ catalog: [provider('anthropic', true)] });
		const service = createService(fake.catalog);
		await service.whenInitialized;
		expect(service.getProvider('anthropic')).toEqual(provider('anthropic', true));

		// A live change event that carries a fresh catalog updates the snapshot in place.
		fake.onDidChangeCatalog.fire(change([provider('anthropic', false)]));
		expect(service.isEnabled('anthropic')).toBe(false);
		expect(service.getProviders()).toEqual([provider('anthropic', false)]);
	});

	it('getConfigFileUri returns file:// on desktop shape and remote-authority URI when remote', async () => {
		const desktop = createService(fakeCatalog({ configFilePath: '/home/user/providers.json' }).catalog, false);
		const desktopUri = await desktop.getConfigFileUri();
		expect(desktopUri.scheme).toBe(Schemas.file);
		expect(desktopUri.path).toBe('/home/user/providers.json');

		const remote = createService(fakeCatalog({ configFilePath: '/remote/providers.json' }).catalog, true);
		const remoteUri = await remote.getConfigFileUri();
		expect(remoteUri.scheme).toBe(Schemas.vscodeRemote);
		expect(remoteUri.authority).toBe('remote-host');
		expect(remoteUri.path).toBe('/remote/providers.json');
	});

	it('a DI-instantiated concrete variant initializes without touching subclass fields during super()', async () => {
		const service = ctx.disposables.add(ctx.instantiationService.createInstance(BrowserAiProviderService));
		await service.whenInitialized;
		// The hazard: a synchronous initialize() in the base constructor would read
		// the not-yet-assigned _remoteAgentService parameter-property, throw, and
		// land the service in permanent 'error'. Deferring the fetch avoids that.
		expect(service.status).toBe('ready');
		expect(service.getProvider('anthropic')).toEqual(provider('anthropic', true));
	});
});
