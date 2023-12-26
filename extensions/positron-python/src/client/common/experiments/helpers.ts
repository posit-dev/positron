// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import { env, workspace } from 'vscode';
import { IExperimentService } from '../types';
import { TerminalEnvVarActivation } from './groups';
import { isTestExecution } from '../constants';
import { traceInfo } from '../../logging';

export function inTerminalEnvVarExperiment(experimentService: IExperimentService): boolean {
    if (!isTestExecution() && env.remoteName && workspace.workspaceFolders && workspace.workspaceFolders.length > 1) {
        // TODO: Remove this if statement once https://github.com/microsoft/vscode/issues/180486 is fixed.
        traceInfo('Not enabling terminal env var experiment in multiroot remote workspaces');
        return false;
    }
    // --- Start Positron ---
    // Always opt into this experiment, as it is more reliable and a better UX than sending
    // activation commands like `pyenv shell x.y.z` or `conda activate` to the terminal.
    // It also provides a visual indicator in the terminal if the active interpreter changes.
    //
    // We leave the dead code path below to make merge conflicts easier to resolve.
    return true;
    // --- End Positron ---
    if (!experimentService.inExperimentSync(TerminalEnvVarActivation.experiment)) {
        return false;
    }
    return true;
}
