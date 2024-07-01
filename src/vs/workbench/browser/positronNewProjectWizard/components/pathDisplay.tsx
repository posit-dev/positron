/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import 'vs/css!./pathDisplay';

import * as React from 'react';
import { useState } from 'react';
import { IPathService } from 'vs/workbench/services/path/common/pathService';
import { truncateMiddle } from 'vs/base/common/strings';


interface NewEnvironmentLocationDisplayProps {
	pathService: IPathService;
	pathComponents: string[];
	maxLength?: number;
}

/**
 * Component to display the location for the new environment while properly
 * formatting the path to the file system its being created in.
 * @returns A `code` element with the formatted path.
 */
export function PathDisplay({ pathService, pathComponents, maxLength = 255 }: NewEnvironmentLocationDisplayProps) {

	const [formattedPath, setFormattedPath] = useState<string>('...');

	React.useEffect(() => {
		pathService.path
			.then((pathBuilder) => {
				const combinedPath = pathBuilder.join(...pathComponents).toString();
				setFormattedPath(truncateMiddle(combinedPath, maxLength));
			});
	}, [pathComponents, pathService.path, maxLength]);

	return <code className='formatted-path-display'>
		{formattedPath}
	</code>;
}
