/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from 'sinon';
import * as providerCatalog from '../providerCatalog';

interface ValidationProvider {
	readonly customHeaders?: Record<string, string>;
}

export function stubValidationCatalog(
	providers: Record<string, ValidationProvider>
): sinon.SinonStub {
	return sinon.stub(providerCatalog, 'getCachedProvider').callsFake(catalogId => {
		const provider = providers[catalogId];
		if (!provider) {
			return undefined;
		}
		return {
			id: catalogId,
			enabled: true,
			connection: { customHeaders: provider.customHeaders },
		};
	});
}
