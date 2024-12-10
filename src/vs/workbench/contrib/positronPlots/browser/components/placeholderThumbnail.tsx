/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2024 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './placeholderThumbnail.css';

// React.
import React from 'react';

export const PlaceholderThumbnail = () => {
	return (
		<div className='plot-thumbnail-placeholder'>
			<span className='codicon codicon-graph' />
		</div>
	);
};
