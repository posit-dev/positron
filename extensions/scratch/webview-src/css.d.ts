/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * esbuild understands a bare CSS import and emits the stylesheet next to the
 * bundle; TypeScript does not, so the module needs declaring. There is nothing
 * to import from it -- the side effect of including it in the build is the
 * whole point.
 */
declare module '*.css';
