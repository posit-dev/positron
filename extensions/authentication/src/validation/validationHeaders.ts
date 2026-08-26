/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { log } from '../log';
import { getCachedProvider } from '../providerCatalog';
import type { ProviderMetadata } from '../providerSources';

export function getProviderCatalogId(metadata: ProviderMetadata): string {
	if (!metadata.catalogId) {
		throw new Error(`Provider "${metadata.id}" does not have a catalog id`);
	}
	return metadata.catalogId;
}

export function getValidationHeaders(
	catalogId: string,
	baseHeaders: Readonly<Record<string, string>>
): Record<string, string> {
	const provider = getCachedProvider(catalogId);
	if (!provider) {
		log.warn(`[Validation] Provider "${catalogId}" is not available in the catalog; proceeding without custom headers.`);
		return { ...baseHeaders };
	}

	const headers = { ...baseHeaders };
	const baseHeaderNames = new Set(
		Object.keys(baseHeaders).map(name => name.toLowerCase())
	);
	for (const [name, value] of Object.entries(
		provider.connection.customHeaders ?? {}
	)) {
		if (baseHeaderNames.has(name.toLowerCase())) {
			log.warn(`[Validation] Skipping configured header "${name}" for provider "${catalogId}" because the validation request already defines it.`);
			continue;
		}
		headers[name] = value;
	}
	return headers;
}
