/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * The git words that the main view never shows (spec 2), as whole words in any letter case. The
 * strings of the view and every text a model writes for it are checked against this pattern.
 */
export const FORBIDDEN_WORDS = /\b(branch|commit|stage[ds]?|rebase|merge|pull|push|fetch|HEAD|conflict)\b/i;
