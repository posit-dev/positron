/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { ILabelService } from 'vs/platform/label/common/label';
import { IPathService } from 'vs/workbench/services/path/common/pathService';

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

	// If the label is empty, return the original URI
	if (labelUpdated === '') {
		return uri;
	}

	// URIs with authority need to have a path with a leading slash
	if (uri.authority) {
		const pathBuilder = await pathService.path;
		if (!labelUpdated.startsWith(pathBuilder.sep)) {
			labelUpdated = pathBuilder.sep + labelUpdated;
		}
	}
	return uri.with({ path: labelUpdated });
};
