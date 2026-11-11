/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Webview panel view type of a Posit Assistant chat editor tab. Positron uses it to open these
 * tabs in a compact window when they're moved into a new window. Lives in workbench/common
 * because the editor part needs it and can't import from contrib. Cross-repo contract: the
 * Assistant registers its panel under this name, so renaming it on either side silently gives
 * Assistant tabs a normal window again.
 */
export const ASSISTANT_WEBVIEW_VIEW_TYPE = 'posit-assistant';
