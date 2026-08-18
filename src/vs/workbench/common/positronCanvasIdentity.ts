/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Webview panel view type of a Posit Assistant Canvas panel -- the whole of
 * Canvas-panel identity; comparing a `WebviewInput.providerId` against it is
 * the declared way to recognize a Canvas. Lives in workbench/common because
 * the editor part needs it too and cannot import from contrib. Part of the
 * cross-repo seam documented in contrib/positronCanvas/README.md.
 */
export const CANVAS_WEBVIEW_VIEW_TYPE = 'posit-assistant.canvas';
