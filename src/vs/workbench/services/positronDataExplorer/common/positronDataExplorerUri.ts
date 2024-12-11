/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { Schemas } from '../../../../base/common/network.js';

/**
 * PositronDataExplorerUri class.
 */
export class PositronDataExplorerUri {
	/**
	 * The Positron data explorer URI scheme.
	 */
	public static Scheme = Schemas.positronDataExplorer;

	/**
	 * Generates a Positron data explorer URI.
	 * @param identifier The identifier, which may refer to a Jupyter comm or file path
	 * @returns The Positron data explorer URI.
	 */
	public static generate(identifier: string): URI {
		return URI.from({
			scheme: PositronDataExplorerUri.Scheme,
			path: `positron-data-explorer-${identifier}`
		});
	}

	/**
	 * Parses a Positron data explorer URI.
	 * @param resource The resource.
	 * @returns The identifier, if successful; otherwise, undefined.
	 */
	public static parse(resource: URI): string | undefined {
		// Check the scheme.
		if (resource.scheme !== PositronDataExplorerUri.Scheme) {
			return undefined;
		}

		// Parse the resource. Either it's a runtime comm id or a duckdb:$PATH identifier
		const match = resource.path.match(
			/^positron-data-explorer-(?:([0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12})|(duckdb:.+))$/
		);

		const uuid = match?.[1];
		const duckdbPath = match?.[2];

		if (typeof uuid === 'string') {
			// UUID
			return uuid;
		} else if (typeof duckdbPath === 'string') {
			// duckdb:path/to/file
			return duckdbPath;
		} else {
			return undefined;
		}
	}
}
