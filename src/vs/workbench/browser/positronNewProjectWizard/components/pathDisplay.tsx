/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./pathDisplay';

import * as React from 'react';
import { useState } from 'react';
import { IPathService } from 'vs/workbench/services/path/common/pathService';


interface NewEnvironmentLocationDisplayProps {
	pathService: IPathService;
	pathComponents: string[];
}

/**
 * Component to display the location for the new environment while properly
 * formatting the path to the file system its being created in.
 * @returns A `code` element with the formatted path.
 */
export function PathDisplay({ pathService, pathComponents }: NewEnvironmentLocationDisplayProps) {

	const [formattedPath, setFormattedPath] = useState<string>('...');

	React.useEffect(() => {
		pathService.path
			.then((pathBuilder) => {
				const combinedPath = pathBuilder.join(...pathComponents).toString();
				setFormattedPath(combinedPath);
			});
	});
	return <code className='formatted-path-display'>
		{formattedPath}
	</code>;
}
