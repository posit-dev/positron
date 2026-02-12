/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Architecture } from '../../../utils/platform';
import { InterpreterInfoJson } from '.';

/**
 * Get the Architecture enum value from interpreter info.
 * Prefers the explicit architecture field, falls back to is64Bit for compatibility.
 *
 * This handles the various architecture string formats returned by different platforms:
 * - macOS: 'arm64' or 'x86_64'
 * - Windows: 'AMD64' or 'ARM64' (normalized to lowercase)
 * - Linux: 'aarch64' or 'x86_64'
 */
export function getArchitectureFromInfo(raw: InterpreterInfoJson): Architecture {
    if (raw.architecture) {
        const normalized = raw.architecture.toLowerCase();
        if (normalized === 'arm64' || normalized === 'aarch64') {
            return Architecture.arm64;
        }
        if (normalized === 'x86_64' || normalized === 'amd64' || normalized === 'x64') {
            return Architecture.x64;
        }
        if (normalized === 'x86' || normalized === 'i386' || normalized === 'i686') {
            return Architecture.x86;
        }
    }
    // Fall back to is64Bit for backward compatibility
    return raw.is64Bit ? Architecture.x64 : Architecture.x86;
}
