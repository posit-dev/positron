/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// The code in extensions/open-remote-wsl has been adapted from https://github.com/jeanp413/open-remote-wsl,
// which is licensed under the MIT license.

export const isWindows = process.platform === 'win32';
export const isMacintosh = process.platform === 'darwin';
export const isLinux = process.platform === 'linux';
