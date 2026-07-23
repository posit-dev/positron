/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import type { ProviderCatalogChange, ResolvedConnection, ResolvedProvider } from 'ai-config/node';
import type { IProviderCatalogChangeData, IResolvedConnectionData, IResolvedProviderData } from '../../common/aiProviderCatalog.js';

// Compile-time guard that the hand-mirrored IPC types stay assignable from the
// ai-config types they mirror at the pinned commit. One-directional: the mirror
// is a deliberate reduced view, so a rename/retype of a mirrored field fails the
// typecheck rather than drifting silently.

const _connection = (c: ResolvedConnection): IResolvedConnectionData => ({
	baseUrl: c.baseUrl,
	endpoint: c.endpoint,
	customHeaders: c.customHeaders,
	aws: c.aws,
	googleCloud: c.googleCloud,
	snowflake: c.snowflake,
});

const _provider = (p: ResolvedProvider): IResolvedProviderData => ({
	id: p.id,
	enabled: p.enabled,
	connection: _connection(p.connection),
});

const _change = (change: ProviderCatalogChange): Omit<IProviderCatalogChangeData, 'catalog'> => ({
	enabledChanged: change.enabledChanged,
	connectionChanged: change.connectionChanged,
	modelsChanged: change.modelsChanged,
});

describe('aiProviderCatalog shape guard', () => {
	it('mirrors ai-config types (compile-time assertion)', () => {
		expect([_connection, _provider, _change]).toHaveLength(3);
	});
});
