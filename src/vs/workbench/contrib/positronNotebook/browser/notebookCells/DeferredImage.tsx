/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { useServices } from 'vs/workbench/contrib/positronNotebook/browser/ServicesProvider';
import { useNotebookInstance } from 'vs/workbench/contrib/positronNotebook/browser/NotebookInstanceProvider';
import { URI } from 'vs/base/common/uri';
import { Schemas } from 'vs/base/common/network';
import { dirname } from 'vs/base/common/resources';

/**
 * Special image component that defers loading of the image while it converts it to a data-url using
 * the `positronNotebookHelpers.convertImageToBase64` command.
 * @param props: Props for `img` element.
 * @returns Image tag that shows the image once it is loaded.
 */
// eslint-disable-next-line react/prop-types
export function DeferredImage({ src = 'no-source', ...props }: React.ComponentPropsWithoutRef<'img'>) {
	const services = useServices();
	const notebookInstance = useNotebookInstance();
	const baseLocation = getNotebookBaseUri(notebookInstance.uri).path;

	const [dataUrl, setDataUrl] = React.useState<string | null>(null);

	React.useEffect(() => {
		services.commandService.executeCommand(
			'positronNotebookHelpers.convertImageToBase64',
			src, baseLocation
		).then((base64: string) => {
			setDataUrl(base64);
		});
	}, [src, baseLocation, services.commandService, services.logService]);

	if (!dataUrl) {
		return <span> Loading image: {dataUrl}</span>;
	}
	return <img src={dataUrl} {...props} />;
}


function getNotebookBaseUri(notebookUri: URI) {
	if (notebookUri.scheme === Schemas.untitled) {
		// TODO: Use workspace context service to set the base URI to workspace root
		throw new Error('Have not yet implemented untitled notebook URIs');
	}

	return dirname(notebookUri);
}
