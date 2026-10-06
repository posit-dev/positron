/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { WorkspaceFolder } from 'vscode';
import { CreateEnvironmentResult } from './proposed.createEnvApis';

/**
 * A Create Environment result for an existing environment that the flow left unchanged
 * ("Use Existing"). Kept out of the proposed API's result type.
 */
type ReusedEnvironmentResult = CreateEnvironmentResult & { readonly reused: true };

/**
 * Builds the result for an existing environment that the flow left unchanged.
 */
export function reusedEnvironmentResult(path: string, workspaceFolder: WorkspaceFolder): CreateEnvironmentResult {
    const result: ReusedEnvironmentResult = { path, workspaceFolder, reused: true };
    return result;
}

/**
 * Whether the flow created the environment, either new or deleted and recreated, rather than
 * reusing an existing one. Only a new environment needs its runtime and sessions replaced.
 */
export function isNewEnvironment(result: CreateEnvironmentResult): boolean {
    return 'reused' in result ? result.reused !== true : true;
}

/**
 * The result without the reused marker. The marker is internal to Positron, so it is
 * removed before the result reaches the public creation event.
 */
export function withoutReusedMarker(result: CreateEnvironmentResult): CreateEnvironmentResult {
    if ('reused' in result) {
        const { reused: _reused, ...rest } = result;
        return rest;
    }
    return result;
}
