/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './placeholderThumbnail.css';

// Other dependencies.
import { localize } from '../../../../../nls.js';

export const PlaceholderThumbnail = () => {
	return (
		<div
			aria-label={localize('positron.plots.placeholderThumbnail', "Plot thumbnail placeholder")}
			className='plot-thumbnail-placeholder'
			role='img'
		>
			<span className='codicon codicon-graph' />
		</div>
	);
};
