/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import { IResolvedProviderData } from '../../../../../platform/positronAiProvider/common/aiProviderCatalog.js';
import { createTestContainer } from '../../../../../test/vitest/positronTestContainer.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { AiProviderServiceStatus, IAiProviderService } from '../../../../services/positronAiProvider/common/aiProviderService.js';
import { getProviderStatus } from '../../browser/providerStatusCommand.js';

/** A resolved catalog entry, as ai-config would supply it. */
function catalogEntry(
	id: string,
	overrides: Partial<IResolvedProviderData> = {}
): IResolvedProviderData {
	return { id, enabled: true, connection: {}, ...overrides };
}

describe('getProviderStatus', () => {
	const ctx = createTestContainer().build();

	/** Wires the one service the command reads. */
	function stubCatalog(options: {
		catalog?: IResolvedProviderData[];
		catalogStatus?: AiProviderServiceStatus;
	} = {}): void {
		const { catalog = [], catalogStatus = 'ready' } = options;
		ctx.instantiationService.stub(IAiProviderService, stubInterface<IAiProviderService>({
			whenInitialized: Promise.resolve(),
			status: catalogStatus,
			getProviders: () => catalog,
			getProvider: (id: string) => catalog.find(provider => provider.id === id),
		}));
	}

	it('reports an enabled provider with the boring fields omitted', async () => {
		stubCatalog({ catalog: [catalogEntry('anthropic')] });

		expect(await getProviderStatus(ctx.instantiationService)).toEqual({
			catalogStatus: 'ready',
			providers: [{ id: 'anthropic', enabled: true, custom: undefined, customizedConnection: undefined }],
		});
	});

	it('reports a disabled provider as disabled', async () => {
		stubCatalog({ catalog: [catalogEntry('anthropic', { enabled: false })] });

		expect((await getProviderStatus(ctx.instantiationService)).providers[0].enabled).toBe(false);
	});

	it('marks a custom entry as custom', async () => {
		stubCatalog({ catalog: [catalogEntry('my-gateway', { custom: true })] });

		expect(await getProviderStatus(ctx.instantiationService)).toEqual({
			catalogStatus: 'ready',
			providers: [{ id: 'my-gateway', enabled: true, custom: true, customizedConnection: undefined }],
		});
	});

	it('passes through the catalog\'s customized-field names without ever carrying connection values', async () => {
		stubCatalog({
			catalog: [catalogEntry('bedrock', {
				connection: { aws: { profile: 'secret-profile' } },
				customizedConnection: ['aws.profile'],
			})],
		});

		const result = await getProviderStatus(ctx.instantiationService);

		expect(result.providers[0].customizedConnection).toEqual(['aws.profile']);
		expect(JSON.stringify(result)).not.toContain('secret-profile');
	});

	it('orders enabled entries before disabled ones, alphabetically within each band', async () => {
		stubCatalog({
			catalog: [
				catalogEntry('zeta'),
				catalogEntry('beta', { enabled: false }),
				catalogEntry('alpha'),
				catalogEntry('amber', { enabled: false }),
			],
		});

		const result = await getProviderStatus(ctx.instantiationService);

		expect(result.providers.map(p => p.id)).toEqual(['alpha', 'zeta', 'amber', 'beta']);
	});

	it('passes a catalog fetch failure through as catalogStatus error', async () => {
		stubCatalog({ catalogStatus: 'error' });

		expect(await getProviderStatus(ctx.instantiationService)).toEqual({
			catalogStatus: 'error',
			providers: [],
		});
	});

	it('reports enablement as unknown, not disabled, when the catalog could not be read', async () => {
		// A stale snapshot can still list entries while the fetch failed; their
		// enablement is unknown, and saying so beats reporting a guess.
		stubCatalog({ catalogStatus: 'error', catalog: [catalogEntry('anthropic')] });

		const result = await getProviderStatus(ctx.instantiationService);

		expect(result.providers[0].enabled).toBeUndefined();
	});

	it('treats a catalog still initializing after the bounded wait the same as unreadable', async () => {
		stubCatalog({ catalogStatus: 'initializing', catalog: [catalogEntry('anthropic')] });

		const result = await getProviderStatus(ctx.instantiationService);

		expect([result.catalogStatus, result.providers[0].enabled]).toEqual(['initializing', undefined]);
	});
});
