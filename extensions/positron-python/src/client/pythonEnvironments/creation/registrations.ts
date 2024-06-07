// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

// --- Start Positron ---
import { IPythonRuntimeManager } from '../../positron/manager';
// --- End Positron ---

import { IDisposableRegistry, IInterpreterPathService, IPathUtils } from '../../common/types';
import { IInterpreterQuickPick } from '../../interpreter/configuration/types';
import { IInterpreterService } from '../../interpreter/contracts';
import { registerCreateEnvironmentFeatures } from './createEnvApi';
import { registerCreateEnvironmentButtonFeatures } from './createEnvButtonContext';
import { registerTriggerForPipInTerminal } from './globalPipInTerminalTrigger';
import { registerInstalledPackagesDiagnosticsProvider } from './installedPackagesDiagnostic';
import { registerPyProjectTomlFeatures } from './pyProjectTomlContext';

export function registerAllCreateEnvironmentFeatures(
    disposables: IDisposableRegistry,
    interpreterQuickPick: IInterpreterQuickPick,
    interpreterPathService: IInterpreterPathService,
    interpreterService: IInterpreterService,
    pathUtils: IPathUtils,
    // --- Start Positron ---
    pythonRuntimeManager: IPythonRuntimeManager,
    // --- End Positron ---
): void {
    // --- Start Positron ---
    registerCreateEnvironmentFeatures(
        disposables,
        interpreterQuickPick,
        interpreterPathService,
        pathUtils,
        pythonRuntimeManager,
    );
    // --- End Positron ---
    registerCreateEnvironmentButtonFeatures(disposables);
    registerPyProjectTomlFeatures(disposables);
    registerInstalledPackagesDiagnosticsProvider(disposables, interpreterService);
    registerTriggerForPipInTerminal(disposables);
}
