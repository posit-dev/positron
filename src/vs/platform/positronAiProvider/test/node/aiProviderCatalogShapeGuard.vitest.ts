/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import type { ProviderCatalogChange, ResolvedConnection, ResolvedProvider } from 'ai-config/node';
import type { IProviderCatalogChangeData, IResolvedConnectionData, IResolvedProviderData } from '../../common/aiProviderCatalog.js';

/**
 * Compile-time guard that the hand-mirrored IPC types in
 * common/aiProviderCatalog.ts stay compatible with the ai-config types they
 * mirror at the pinned ai-lib commit. The mirror is a deliberate reduced view
 * (ai-config's protocol/endpoints/positaiLogin/clientKind/models are omitted),
 * so the assertion is one-directional: the fields we DO mirror must remain
 * assignable from ai-config's. A rename or retype of a mirrored field on a pin
 * bump (e.g. aws.region) fails this typecheck instead of silently drifting.
 *
 * The checks are `satisfies` assignments, evaluated by the compiler only; the
 * `it` block exists so the file runs as a normal test.
 */

// Picks the mirrored subset of an ai-config connection; assignment fails to
// compile if any mirrored field's type diverges from ai-config's.
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
		// The guard is the module-level typed assignments above; if they compile,
		// the mirror is still compatible with the pinned ai-config shape.
		expect([_connection, _provider, _change]).toHaveLength(3);
	});
});
