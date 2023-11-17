/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import './DataPanel.css';

// External libraries.
import * as React from 'react';

export const LoadingOverlay = (
	{isLoading, container, header}: {isLoading: boolean; container: HTMLDivElement | null; header: HTMLTableSectionElement | null}) => {

	if (!isLoading || !container || !header) {
		return null;
	}

	const {clientWidth, clientHeight, offsetWidth, offsetHeight} = container;
	const {clientHeight: headerHeight, clientWidth: headerWidth} = header;

	// Vertically and horizontally center the loading overlay
	// accounting for scrollbars, header, and container size
	const verticalScrollbarWidth = offsetWidth - clientWidth;
	const horizontalScrollbarHeight = offsetHeight - clientHeight;
	const marginTop = (clientHeight - headerHeight) / 2;
	const marginBottom = horizontalScrollbarHeight;
	const marginRight = verticalScrollbarWidth;
	// Use the table header width rather than the full container width
	// when the table doesn't take up the full width of the container
	const marginLeft = Math.min(headerWidth, clientWidth) / 2;

	return (
		<div className='overlay' style={{marginTop, marginBottom, marginRight, marginLeft}}>
			<div className='loading'>
				Loading more rows...
			</div>
		</div>
	);

};
