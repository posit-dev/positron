/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// CSS.
import './media/positronGettingStarted.css';

// Other dependencies.
import { PositronReactRenderer } from '../../../../base/browser/positronReactRenderer.js';
import { PositronWelcomePageStart } from './positronWelcomePageStart.js';

export const createWelcomePageLeft = (container: HTMLElement): PositronReactRenderer => {
	const renderer = new PositronReactRenderer(container);
	renderer.render(
		<PositronWelcomePageStart />
	);
	return renderer;
};
