// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

export enum DiagnosticCodes {
    InvalidEnvironmentPathVariableDiagnostic = 'InvalidEnvironmentPathVariableDiagnostic',
    InvalidDebuggerTypeDiagnostic = 'InvalidDebuggerTypeDiagnostic',
    NoPythonInterpretersDiagnostic = 'NoPythonInterpretersDiagnostic',
    MacInterpreterSelected = 'MacInterpreterSelected',
    // --- Start Positron ---
    // Add a new diagnostic code for unsupported Python versions
    UnsupportedPythonVersion = 'UnsupportedPythonVersion',
    // and another for multiple language servers
    MultipleLanguageServersDiagnostic = 'MultipleLanguageServersDiagnostic',
    // --- End Positron ---
    InvalidPythonPathInDebuggerSettingsDiagnostic = 'InvalidPythonPathInDebuggerSettingsDiagnostic',
    InvalidPythonPathInDebuggerLaunchDiagnostic = 'InvalidPythonPathInDebuggerLaunchDiagnostic',
    EnvironmentActivationInPowerShellWithBatchFilesNotSupportedDiagnostic = 'EnvironmentActivationInPowerShellWithBatchFilesNotSupportedDiagnostic',
    InvalidPythonInterpreterDiagnostic = 'InvalidPythonInterpreterDiagnostic',
    InvalidComspecDiagnostic = 'InvalidComspecDiagnostic',
    IncompletePathVarDiagnostic = 'IncompletePathVarDiagnostic',
    DefaultShellErrorDiagnostic = 'DefaultShellErrorDiagnostic',
    LSNotSupportedDiagnostic = 'LSNotSupportedDiagnostic',
    PythonPathDeprecatedDiagnostic = 'PythonPathDeprecatedDiagnostic',
    JustMyCodeDiagnostic = 'JustMyCodeDiagnostic',
    ConsoleTypeDiagnostic = 'ConsoleTypeDiagnostic',
    ConfigPythonPathDiagnostic = 'ConfigPythonPathDiagnostic',
    PylanceDefaultDiagnostic = 'PylanceDefaultDiagnostic',
    JediPython27NotSupportedDiagnostic = 'JediPython27NotSupportedDiagnostic',
    SwitchToDefaultLanguageServerDiagnostic = 'SwitchToDefaultLanguageServerDiagnostic',
    SwitchToPreReleaseExtensionDiagnostic = 'SwitchToPreReleaseExtensionDiagnostic',
}
