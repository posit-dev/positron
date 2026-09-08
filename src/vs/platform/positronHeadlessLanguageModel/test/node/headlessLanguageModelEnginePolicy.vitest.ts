/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { Event } from '../../../../base/common/event.js';
import { URI } from '../../../../base/common/uri.js';
import { IAiProviderCatalog, IResolvedModelsData, IResolvedProviderData } from '../../../positronAiProvider/common/aiProviderCatalog.js';
import { applyModelPolicy } from '../../node/headlessLanguageModelEngine.js';

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
