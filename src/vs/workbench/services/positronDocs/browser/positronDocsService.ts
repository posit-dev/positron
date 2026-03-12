/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { IBrowserWorkbenchEnvironmentService } from '../../environment/browser/environmentService.js';

/**
 * The default Positron documentation URL.
 */
const POSITRON_DOCS_DEFAULT_URL = 'https://positron.posit.co/';

/**
 * Service identifier for the Positron docs service.
 */
export const IPositronDocsService = createDecorator<IPositronDocsService>('positronDocsService');

/**
 * Service that provides URLs for Positron documentation.
 *
 * When running inside Posit Workbench, the documentation may be hosted locally
 * and configured via the POSITRON_DOCS_URL environment variable. This service
 * centralizes the logic for determining the correct documentation URL.
 */
export interface IPositronDocsService {
	readonly _serviceBrand: undefined;

	/**
	 * The base URL for Positron documentation.
	 * Returns the configured URL from POSITRON_DOCS_URL or the default public URL.
	 */
	readonly baseUrl: string;

	/**
	 * Gets the full URL for a documentation path.
	 * @param path The path relative to the docs root (e.g., 'assistant', 'positron-notebook-editor')
	 * @returns The full URL to the documentation page
	 */
	getUrl(path?: string): string;
}

/**
 * Implementation of the Positron docs service.
 */
export class PositronDocsService implements IPositronDocsService {
	readonly _serviceBrand: undefined;

	readonly baseUrl: string;

	constructor(
		@IBrowserWorkbenchEnvironmentService environmentService: IBrowserWorkbenchEnvironmentService,
	) {
		this.baseUrl = environmentService.positronDocsUrl ?? POSITRON_DOCS_DEFAULT_URL;
	}

	getUrl(path?: string): string {
		if (!path) {
			return this.baseUrl;
		}
		// Ensure baseUrl ends with / and path doesn't start with /
		const base = this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`;
		const cleanPath = path.startsWith('/') ? path.slice(1) : path;
		return `${base}${cleanPath}`;
	}
}

registerSingleton(IPositronDocsService, PositronDocsService, InstantiationType.Delayed);
