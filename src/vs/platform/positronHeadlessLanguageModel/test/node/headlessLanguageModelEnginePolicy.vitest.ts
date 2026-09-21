/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { NullLogService } from '../../../log/common/log.js';
import { IAiProviderCatalog, IProviderCatalogChangeData, IResolvedModelsData, IResolvedProviderData } from '../../../positronAiProvider/common/aiProviderCatalog.js';
import { applyModelPolicy, HeadlessLanguageModelEngine } from '../../node/headlessLanguageModelEngine.js';

async function collect(stream: AsyncIterable<string>): Promise<string> {
	let text = '';
	for await (const chunk of stream) {
		text += chunk;
	}
	return text;
}

/** A discovered model as the bridge reports it: identity plus the capabilities ai-config resolves against. */
function model(id: string, name: string, vendor = 'Anthropic') {
	return {
		id,
		name,
		vendor,
		maxContextLength: 200000,
		supportsTools: true,
		supportsImages: true,
		supportsToolResultImages: false,
		supportsWebSearch: false,
	};
}

function catalog(models: IResolvedModelsData | undefined, id = 'anthropic'): IAiProviderCatalog {
	const provider: IResolvedProviderData = { id, enabled: true, connection: {}, models };
	return {
		onDidChangeCatalog: Event.None,
		getCatalog: () => Promise.resolve([provider]),
		getConfigFileUri: () => Promise.resolve(URI.file('/providers.json')),
	};
}

function catalogOf(providers: IResolvedProviderData[], onDidChangeCatalog: Event<IProviderCatalogChangeData> = Event.None): IAiProviderCatalog {
	return {
		onDidChangeCatalog,
		getCatalog: () => Promise.resolve(providers),
		getConfigFileUri: () => Promise.resolve(URI.file('/providers.json')),
	};
}

describe('applyModelPolicy', () => {
	const discovered = [
		model('claude-opus-5', 'Claude Opus 5'),
		model('claude-sonnet-5', 'Claude Sonnet 5'),
		model('claude-haiku-5', 'Claude Haiku 5'),
	];

	it('applies allow and deny, with deny winning', async () => {
		const resolved = await applyModelPolicy(
			catalog({ allow: ['claude-opus-5', 'claude-sonnet-5'], deny: ['claude-sonnet-5'] }),
			'anthropic',
			discovered,
		);

		expect(resolved.map(m => m.id)).toEqual(['claude-opus-5']);
	});

	it('drops every discovered model when discovery is off', async () => {
		const resolved = await applyModelPolicy(catalog({ discovery: 'off' }), 'anthropic', discovered);

		expect(resolved).toEqual([]);
	});

	it('materializes a custom model discovery never returned', async () => {
		const resolved = await applyModelPolicy(
			catalog({
				custom: [{
					id: 'claude-custom',
					name: 'Claude Custom',
					maxContextLength: 100000,
					supportsTools: true,
					supportsImages: true,
					supportsToolResultImages: false,
					supportsWebSearch: false,
				}],
			}),
			'anthropic',
			[],
		);

		expect(resolved).toEqual([{
			id: 'claude-custom',
			name: 'Claude Custom',
			vendor: 'anthropic',
			providerId: 'anthropic',
		}]);
	});

	it('keeps a discovered model\'s vendor while dropping its denied siblings', async () => {
		const resolved = await applyModelPolicy(catalog({ deny: ['claude-haiku-5'] }), 'anthropic', discovered);

		expect(resolved).toEqual([
			{ id: 'claude-opus-5', name: 'Claude Opus 5', vendor: 'Anthropic', providerId: 'anthropic' },
			{ id: 'claude-sonnet-5', name: 'Claude Sonnet 5', vendor: 'Anthropic', providerId: 'anthropic' },
		]);
	});

	it('passes models through when the provider has no policy', async () => {
		const resolved = await applyModelPolicy(catalog(undefined), 'anthropic', discovered);

		expect(resolved.map(m => m.id)).toEqual(['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-5']);
	});

	it('passes models through for a provider the catalog does not list', async () => {
		const resolved = await applyModelPolicy(catalog({ deny: ['claude-opus-5'] }, 'openai'), 'anthropic', discovered);

		expect(resolved.map(m => m.id)).toEqual(['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-5']);
	});
});

describe('getProviderMappings', () => {
	it('adds one aggregate mapping per custom entry after the built-ins', async () => {
		const engine = new HeadlessLanguageModelEngine(new NullLogService(), catalogOf([
			{ id: 'anthropic', enabled: true, connection: {} },
			{ id: 'my-gateway', enabled: true, clientKind: 'openai-compatible', connection: {}, custom: true },
			{ id: 'team-snow', enabled: true, clientKind: 'snowflake', connection: {}, custom: true },
			{ id: 'local-llm', enabled: true, clientKind: 'ollama', connection: {}, custom: true },
			{ id: 'no-kind', enabled: true, connection: {}, custom: true },
		]));
		const mappings = await engine.getProviderMappings();
		expect(mappings.find(m => m.providerId === 'anthropic')).toBeDefined();
		expect(mappings.filter(m => m.authProviderId === 'custom-providers')).toEqual([
			{ providerId: 'my-gateway', authProviderId: 'custom-providers', scopes: ['my-gateway'], credentialType: 'apikey', configKey: 'my-gateway' },
			{ providerId: 'team-snow', authProviderId: 'custom-providers', scopes: ['team-snow'], credentialType: 'apikey', configKey: 'team-snow', structuredBaseUrl: 'snowflake' },
		]);
	});
});

describe('registry follows the catalog', () => {
	it('lists a custom entry added after first use', async () => {
		const changed = new Emitter<IProviderCatalogChangeData>();
		let entries: IResolvedProviderData[] = [{ id: 'anthropic', enabled: true, connection: {} }];
		const engine = new HeadlessLanguageModelEngine(new NullLogService(), {
			onDidChangeCatalog: changed.event,
			getCatalog: () => Promise.resolve(entries),
			getConfigFileUri: () => Promise.resolve(URI.file('/providers.json')),
		});
		await engine.listModels('my-gateway', { type: 'apikey', apiKey: 'k', baseUrl: 'http://127.0.0.1:1' });
		entries = [...entries, { id: 'my-gateway', enabled: true, clientKind: 'openai-compatible', connection: {}, custom: true }];
		changed.fire({ catalog: [], enabledChanged: true, connectionChanged: false, modelsChanged: false });
		// A stream request no longer fails at the registry-lookup boundary (the
		// specific error the pre-rebuild registry would throw), proving the
		// registry rebuilt rather than serving its stale first-use snapshot.
		const stream = engine.streamChat({ providerId: 'my-gateway', modelId: 'm', systemPrompt: 's', messages: [{ role: 'user', content: 'hi' }], credentials: { type: 'apikey', apiKey: 'k', baseUrl: 'http://127.0.0.1:1' } }, CancellationToken.None);
		await expect(collect(stream)).resolves.not.toThrow();
	}, 15_000);
});
