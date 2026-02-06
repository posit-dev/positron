/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Allow side-effect CSS imports when bundling the notebook renderer.
// The bundler (esbuild) handles the actual CSS loading.

declare module '*.css';

declare module '@fortawesome/fontawesome-free/css/*';
declare module '@jupyter-widgets/base/css/*';
declare module '@jupyter-widgets/controls/css/*';
declare module '@lumino/widgets/style/*';
