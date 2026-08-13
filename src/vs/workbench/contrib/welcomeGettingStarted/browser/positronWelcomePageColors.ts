/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerColor } from '../../../../platform/theme/common/colorRegistry.js';
import { localize } from '../../../../nls.js';
import { welcomePageTileBackground, welcomePageTileBorder } from './gettingStartedColors.js';

// Colors for the redesigned welcome page, behind the `welcomePage.experimental`
// setting.

// The default follows the tiles on the original page, which every theme already
// tunes, so the banner looks native in a theme nobody here has seen. Positron's
// own light theme paints it a pale blue instead; a theme wanting that look sets
// this color rather than getting a blue it never chose.
export const POSITRON_WELCOME_BANNER_BACKGROUND = registerColor('positronWelcome.bannerBackground',
	welcomePageTileBackground,
	localize('positronWelcome.bannerBackground', "Background color of the walkthrough banner on the Positron welcome page."));

export const POSITRON_WELCOME_BANNER_BORDER = registerColor('positronWelcome.bannerBorder',
	welcomePageTileBorder,
	localize('positronWelcome.bannerBorder', "Border color of the walkthrough banner on the Positron welcome page."));
