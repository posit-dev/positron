/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, QuickPickItem } from 'vscode';
import { showQuickPickWithBack } from '../../../common/vscodeApis/windowApis';
import { CreateEnv } from '../../../common/utils/localize';
import { getAvailablePythonVersions } from '../../common/environmentManagers/uv';

// Fallback versions if uv is not installed or fails to fetch versions
const SUPPORTED_UV_PYTHON_VERSIONS = ['3.14', '3.13', '3.12', '3.11', '3.10', '3.9'];

/**
 * Gets available Python versions for uv environments.
 * Dynamically fetches from uv if available, otherwise falls back to a static list.
 * @returns Object containing array of version strings
 */
export async function getUvPythonVersions(): Promise<{ versions: string[] }> {
    try {
        const availableVersions = await getAvailablePythonVersions();
        if (availableVersions.length > 0) {
            return {
                versions: availableVersions.map((v) => v.version),
            };
        }
    } catch {
        // Fall through to fallback
    }
    return {
        versions: SUPPORTED_UV_PYTHON_VERSIONS,
    };
}

/**
 * Shows a quick pick for selecting a Python version for uv environment creation.
 * @param token Cancellation token
 * @returns The selected version, or undefined if cancelled
 */
export async function pickPythonVersion(token?: CancellationToken): Promise<string | undefined> {
    const { versions } = await getUvPythonVersions();
    const items: QuickPickItem[] = versions.map((v) => ({
        label: 'Python',
        description: v,
    }));
    const selection = await showQuickPickWithBack(
        items,
        {
            placeHolder: CreateEnv.Conda.selectPythonQuickPickPlaceholder,
            matchOnDescription: true,
            ignoreFocusOut: true,
        },
        token,
    );

    if (selection) {
        return (selection as QuickPickItem).description;
    }

    return undefined;
}
