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

		// Parse the resource. Either it's a runtime comm id (a UUID) or a scheme-prefixed
		// extension-backend identifier such as "duckdb:$PATH" (file backends) or
		// "sqlite:$CONNECTION:$KIND:$NAME" (data connection drivers).
		const match = resource.path.match(
			/^positron-data-explorer-(?:([0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12})|([a-z][a-z0-9+.-]*:.+))$/
		);

		const uuid = match?.[1];
		const backendIdentifier = match?.[2];

		if (typeof uuid === 'string') {
			// Runtime comm id.
			return uuid;
		} else if (typeof backendIdentifier === 'string') {
			// Extension-backend identifier (e.g. duckdb:... or sqlite:...).
			return backendIdentifier;
		} else {
			return undefined;
		}
	}

	/**
	 * Parses a Positron data explorer URI and retrieves the URI of the backing file, if any.
	 * @param resource The data explorer resource.
	 * @returns A URI for the backing file, if any.
	 */
	public static backingUri(resource: URI): URI | undefined {
		const identifier = PositronDataExplorerUri.parse(resource);
		// Runtime comm IDs have no originating URIs.
		if (!identifier || !identifier.startsWith('duckdb:')) {
			return undefined;
		}
		// This will be something like "duckdb:file:///path/to/file.csv".
		return URI.parse(identifier.replace('duckdb:', ''));
	}
}
