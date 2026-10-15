/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { Schemas } from '../../../../base/common/network.js';

/**
 * The prefix of identifiers for object explorers backed by a JSON file.
 */
export const JSON_IDENTIFIER_PREFIX = 'json:';

/**
 * PositronObjectExplorerUri class.
 */
export class PositronObjectExplorerUri {
	/**
	 * Generates a Positron object explorer URI.
	 * @param identifier The identifier: a runtime comm id, or `json:<file uri>`.
	 * @returns The Positron object explorer URI.
	 */
	static generate(identifier: string): URI {
		return URI.from({
			scheme: Schemas.positronObjectExplorer,
			path: `positron-object-explorer-${identifier}`
		});
	}

	/**
	 * Parses a Positron object explorer URI.
	 * @param resource The resource.
	 * @returns The identifier, if successful; otherwise, undefined.
	 */
	static parse(resource: URI): string | undefined {
		if (resource.scheme !== Schemas.positronObjectExplorer) {
			return undefined;
		}

		// Either a runtime comm id (a UUID) or a scheme-prefixed identifier such as "json:$URI".
		const match = resource.path.match(
			/^positron-object-explorer-(?<identifier>[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|[a-z][a-z0-9+.-]*:.+)$/
		);
		return match?.groups?.identifier;
	}

	/**
	 * Parses a Positron object explorer URI and returns the URI of the file backing it, if any.
	 * @param resource The object explorer resource.
	 * @returns The URI of the backing file, if any.
	 */
	static backingUri(resource: URI): URI | undefined {
		const identifier = PositronObjectExplorerUri.parse(resource);
		if (!identifier?.startsWith(JSON_IDENTIFIER_PREFIX)) {
			return undefined;
		}
		return URI.parse(identifier.substring(JSON_IDENTIFIER_PREFIX.length));
	}
}
