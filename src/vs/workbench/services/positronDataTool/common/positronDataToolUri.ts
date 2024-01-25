/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { Schemas } from 'vs/base/common/network';

/**
 * PositronDataToolUri class.
 */
export class PositronDataToolUri {
	/**
	 * The Positron data tool URI scheme.
	 */
	public static Scheme = Schemas.positronDataTool;

	/**
	 * Generates a Positron data tool URI.
	 * @param identifier The identifier.
	 * @returns The Positron data tool URI.
	 */
	public static generate(identifier: string): URI {
		return URI.from({
			scheme: PositronDataToolUri.Scheme,
			path: `positron-data-tool-${identifier}`
		});
	}

	/**
	 * Parses a Positron data tool URI.
	 * @param resource The resource.
	 * @returns The identifier, if successful; otherwise, undefined.
	 */
	public static parse(resource: URI): string | undefined {
		// Check the scheme.
		if (resource.scheme !== PositronDataToolUri.Scheme) {
			return undefined;
		}

		// Parse the resource.
		const match = resource.path.match(/^positron-data-tool-([0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12})$/);
		const identifier = match?.[1];
		if (typeof identifier !== 'string') {
			return undefined;
		}

		// Return the identifier.
		return identifier;
	}
}
