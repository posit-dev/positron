/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	chartsGreen,
	disabledForeground,
	editorBackground,
	foreground,
	problemsErrorIconForeground,
	problemsWarningIconForeground,
	registerColor,
	transparent,
} from '../../../../platform/theme/common/colorRegistry.js';
import { localize } from '../../../../nls.js';
import { welcomePageTileBackground, welcomePageTileBorder } from './gettingStartedColors.js';

// Colors for the Positron welcome page.

// The Help button in the header is an outline: no fill, so it stays quieter than
// the fix buttons in the environment setup card, which are the only controls on
// the page worth pressing. Sharing the tile border keeps it in line with the card
// and the banner below it.
export const POSITRON_WELCOME_HEADER_BUTTON_BORDER = registerColor('positronWelcome.headerButtonBorder',
	welcomePageTileBorder,
	localize('positronWelcome.headerButtonBorder', "Border color of the Help button in the header of the Positron welcome page."));

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


export const POSITRON_WELCOME_ENVIRONMENT_SETUP_BACKGROUND = registerColor('positronWelcome.environmentSetupBackground',
	editorBackground,
	localize('positronWelcome.environmentSetupBackground', "Background color of the environment setup card on the Positron welcome page."));

export const POSITRON_WELCOME_ENVIRONMENT_SETUP_BORDER = registerColor('positronWelcome.environmentSetupBorder',
	welcomePageTileBorder,
	localize('positronWelcome.environmentSetupBorder', "Border color of the environment setup card on the Positron welcome page, and of the dividers between its rows."));

// Null in high contrast, where a tinted panel reads as a border that is not
// there. The row dividers carry the separation instead.
export const POSITRON_WELCOME_ENVIRONMENT_SETUP_LANGUAGE_HEADER_BACKGROUND = registerColor('positronWelcome.environmentSetupLanguageHeaderBackground',
	{ dark: transparent(foreground, 0.04), light: transparent(foreground, 0.04), hcDark: null, hcLight: null },
	localize('positronWelcome.environmentSetupLanguageHeaderBackground', "Background color of the language header rows in the environment setup card on the Positron welcome page."));

export const POSITRON_WELCOME_ENVIRONMENT_SETUP_TITLE_FOREGROUND = registerColor('positronWelcome.environmentSetupTitleForeground',
	foreground,
	localize('positronWelcome.environmentSetupTitleForeground', "Foreground color of the environment setup card's title bar on the Positron welcome page."));

export const POSITRON_WELCOME_ENVIRONMENT_SETUP_PASS_ICON = registerColor('positronWelcome.environmentSetupPassIcon',
	chartsGreen,
	localize('positronWelcome.environmentSetupPassIcon', "Color of the icon for a check that passed on the Positron welcome page."));

export const POSITRON_WELCOME_ENVIRONMENT_SETUP_WARNING_ICON = registerColor('positronWelcome.environmentSetupWarningIcon',
	problemsWarningIconForeground,
	localize('positronWelcome.environmentSetupWarningIcon', "Color of the icon for a check that needs attention on the Positron welcome page."));

export const POSITRON_WELCOME_ENVIRONMENT_SETUP_ERROR_ICON = registerColor('positronWelcome.environmentSetupErrorIcon',
	problemsErrorIconForeground,
	localize('positronWelcome.environmentSetupErrorIcon', "Color of the icon for a check that failed on the Positron welcome page."));

export const POSITRON_WELCOME_ENVIRONMENT_SETUP_SKIPPED_ICON = registerColor('positronWelcome.environmentSetupSkippedIcon',
	disabledForeground,
	localize('positronWelcome.environmentSetupSkippedIcon', "Color of the icon for a check that was not run on the Positron welcome page."));
