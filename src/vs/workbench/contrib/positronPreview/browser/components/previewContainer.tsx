/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as React from 'react';
import { useEffect } from 'react'; // eslint-disable-line no-duplicate-imports
import { usePositronPreviewContext } from 'vs/workbench/contrib/positronPreview/browser/positronPreviewContext';

/**
 * PreviewContainerProps interface.
 */
interface PreviewContainerProps {
	width: number;
	height: number;
}

/**
 * PreviewContainer component; holds the preview items.
 *
 * @param props A PreviewContainerProps that contains the component properties.
 * @returns The rendered component.
 */
export const PreviewContainer = (props: PreviewContainerProps) => {

	const positronPreviewContext = usePositronPreviewContext();

	useEffect(() => {
		// Empty for now.
	});

	// If there are no plot instances, show a placeholder; otherwise, show the
	// most recently generated plot.
	return (
		<div>
			<h1>Hello, world!</h1>
			<p>The selected item is: {positronPreviewContext.selectedItemId}</p>
		</div>
	);
};
