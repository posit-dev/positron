/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../base/common/uri.js';
import { ILabelService } from '../../../platform/label/common/label.js';
import { IPathService } from '../../services/path/common/pathService.js';

/**
 * Converts a URI path to a label, with awareness of the operating system that the positron server
 * is running on. The path is formatted according to the platform on which the server is running,
 * which will be the platform that the path exists on.
 * @param path The URI path to convert to a label.
 * @param labelService The label service.
 * @returns The label.
 */
export const pathUriToLabel = (path: URI, labelService: ILabelService): string => {
	return labelService.getUriLabel(path, { noPrefix: true });
};

/**
 * Combines a label with a URI path, ensuring that the label is not empty and that the URI path
 * has a leading slash if it has an authority.
 * @param label The label to combine with the URI path. This string is expected to have been created
 * via the label service.
 * @param uri The URI to combine with the label.
 * @param pathService The path service.
 * @returns A promise that resolves to the combined URI.
 */
export const combineLabelWithPathUri = async (
	label: string,
	uri: URI,
	pathService: IPathService
): Promise<URI> => {
	let labelUpdated = label.trim();

	// If the label is empty, return the original URI with the path cleared.
	if (labelUpdated === '') {
		return uri.with({ path: '' });
	}

	// Prepend a slash to the label if it doesn't already have one. This is necessary in order to
	// properly combine the label with the URI.
	if (!labelUpdated.startsWith('/')) {
		labelUpdated = '/' + labelUpdated;
	}

	// Get the path library for the platform on which the server is running.
	const pathLib = await pathService.path;

	// Check if we need to add the trailing slash back to the label.
	let includeTrailingSlash = false;
	if (labelUpdated.endsWith('/') || labelUpdated.endsWith('\\')) {
		includeTrailingSlash = true;
	}

	// This normalizes and formats the path according to the platform on which the server is running.
	// Unfortunately, it removes the trailing slash, so we need to add it back if it was there originally.
	labelUpdated = pathLib.format(pathLib.parse(labelUpdated));
	if (includeTrailingSlash) {
		labelUpdated += pathLib.sep;
	}

	return uri.with({ path: labelUpdated });
};
