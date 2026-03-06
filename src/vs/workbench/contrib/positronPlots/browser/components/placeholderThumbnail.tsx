/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2023-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './placeholderThumbnail.css';

// Other dependencies.
import { ThemeIcon } from '../../../../../platform/positronActionBar/browser/components/icon.js';
import { Codicon } from '../../../../../base/common/codicons.js';

export const PlaceholderThumbnail = () => {
	return (
		<div className='plot-thumbnail-placeholder'>
			<ThemeIcon icon={Codicon.graph} />
		</div>
	);
};
