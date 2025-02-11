/* eslint-disable camelcase */

// --- Start Positron ---
import { PythonVersion } from '../pythonEnvironments/info/pythonVersion';
// --- End Positron ---

/* eslint-disable @typescript-eslint/no-namespace */
export const PYTHON_LANGUAGE = 'python';
export const PYTHON_WARNINGS = 'PYTHONWARNINGS';

export const NotebookCellScheme = 'vscode-notebook-cell';
export const InteractiveInputScheme = 'vscode-interactive-input';
export const InteractiveScheme = 'vscode-interactive';
export const PYTHON = [
    { scheme: 'file', language: PYTHON_LANGUAGE },
    { scheme: 'untitled', language: PYTHON_LANGUAGE },
    { scheme: 'vscode-notebook', language: PYTHON_LANGUAGE },
    { scheme: NotebookCellScheme, language: PYTHON_LANGUAGE },
    { scheme: InteractiveInputScheme, language: PYTHON_LANGUAGE },
];

export const PYTHON_NOTEBOOKS = [
    { scheme: 'vscode-notebook', language: PYTHON_LANGUAGE },
    { scheme: NotebookCellScheme, language: PYTHON_LANGUAGE },
    { scheme: InteractiveInputScheme, language: PYTHON_LANGUAGE },
];

export const PVSC_EXTENSION_ID = 'ms-python.python';
export const PYLANCE_EXTENSION_ID = 'ms-python.vscode-pylance';
export const JUPYTER_EXTENSION_ID = 'ms-toolsai.jupyter';
export const TENSORBOARD_EXTENSION_ID = 'ms-toolsai.tensorboard';
export const AppinsightsKey = '0c6ae279ed8443289764825290e4f9e2-1a736e7c-1324-4338-be46-fc2a58ae4d14-7255';

export type Channel = 'stable' | 'insiders';

export enum CommandSource {
    ui = 'ui',
    commandPalette = 'commandpalette',
}

export namespace Commands {
    export const ClearStorage = 'python.clearCacheAndReload';
    export const CreateNewFile = 'python.createNewFile';
    export const ClearWorkspaceInterpreter = 'python.clearWorkspaceInterpreter';
    export const Create_Environment = 'python.createEnvironment';
    export const Create_Environment_Button = 'python.createEnvironment-button';
    export const Create_Environment_Check = 'python.createEnvironmentCheck';
    export const Create_Terminal = 'python.createTerminal';
    export const Debug_In_Terminal = 'python.debugInTerminal';
    export const Exec_In_Terminal = 'python.execInTerminal';
    export const Exec_In_Terminal_Icon = 'python.execInTerminal-icon';
    export const Exec_In_Separate_Terminal = 'python.execInDedicatedTerminal';
    // --- Start Positron ---
    export const Exec_Dash_In_Terminal = 'python.execDashInTerminal';
    export const Exec_FastAPI_In_Terminal = 'python.execFastAPIInTerminal';
    export const Exec_Flask_In_Terminal = 'python.execFlaskInTerminal';
    export const Exec_Gradio_In_Terminal = 'python.execGradioInTerminal';
    export const Exec_Shiny_In_Terminal = 'python.execShinyInTerminal';
    export const Exec_Streamlit_In_Terminal = 'python.execStreamlitInTerminal';
    export const Exec_In_Console = 'python.execInConsole';
    export const Exec_Selection_In_Console = 'python.execSelectionInConsole';
    export const Debug_Dash_In_Terminal = 'python.debugDashInTerminal';
    export const Debug_FastAPI_In_Terminal = 'python.debugFastAPIInTerminal';
    export const Debug_Flask_In_Terminal = 'python.debugFlaskInTerminal';
    export const Debug_Gradio_In_Terminal = 'python.debugGradioInTerminal';
    export const Debug_Shiny_In_Terminal = 'python.debugShinyInTerminal';
    export const Debug_Streamlit_In_Terminal = 'python.debugStreamlitInTerminal';
    // --- End Positron ---
    export const Exec_In_REPL = 'python.execInREPL';
    export const Exec_Selection_In_Django_Shell = 'python.execSelectionInDjangoShell';
    export const Exec_In_REPL_Enter = 'python.execInREPLEnter';
    export const Exec_In_IW_Enter = 'python.execInInteractiveWindowEnter';
    export const Exec_Selection_In_Terminal = 'python.execSelectionInTerminal';
    // --- Start Positron ---
    export const Focus_Positron_Console = 'workbench.panel.positronConsole.focus';
    // --- End Positron ---
    export const GetSelectedInterpreterPath = 'python.interpreterPath';
    // --- Start Positron ---
    export const Create_Environment_And_Register = 'python.createEnvironmentAndRegister';
    export const Get_Create_Environment_Providers = 'python.getCreateEnvironmentProviders';
    export const Is_Conda_Installed = 'python.isCondaInstalled';
    export const Get_Conda_Python_Versions = 'python.getCondaPythonVersions';
    export const Is_Global_Python = 'python.isGlobalPython';
    // --- End Positron ---
    export const InstallJupyter = 'python.installJupyter';
    export const InstallPython = 'python.installPython';
    export const InstallPythonOnLinux = 'python.installPythonOnLinux';
    export const InstallPythonOnMac = 'python.installPythonOnMac';
    export const PickLocalProcess = 'python.pickLocalProcess';
    export const ReportIssue = 'python.reportIssue';
    export const Set_Interpreter = 'python.setInterpreter';
    export const Set_ShebangInterpreter = 'python.setShebangInterpreter';
    export const Start_REPL = 'python.startREPL';
    export const Start_Native_REPL = 'python.startNativeREPL';
    export const Tests_Configure = 'python.configureTests';
    export const Tests_CopilotSetup = 'python.copilotSetupTests';
    export const TriggerEnvironmentSelection = 'python.triggerEnvSelection';
    export const ViewOutput = 'python.viewOutput';
}

// Look at https://microsoft.github.io/vscode-codicons/dist/codicon.html for other Octicon icon ids
export namespace Octicons {
    export const Add = '$(add)';
    export const Test_Pass = '$(check)';
    export const Test_Fail = '$(alert)';
    export const Test_Error = '$(x)';
    export const Test_Skip = '$(circle-slash)';
    export const Downloading = '$(cloud-download)';
    export const Installing = '$(desktop-download)';
    export const Search = '$(search)';
    export const Search_Stop = '$(search-stop)';
    export const Star = '$(star-full)';
    export const Gear = '$(gear)';
    export const Warning = '$(warning)';
    export const Error = '$(error)';
    export const Lightbulb = '$(lightbulb)';
    export const Folder = '$(folder)';
}

/**
 * Look at https://code.visualstudio.com/api/references/icons-in-labels#icon-listing for ThemeIcon ids.
 * Using a theme icon is preferred over a custom icon as it gives product theme authors the possibility
 * to change the icons.
 */
export namespace ThemeIcons {
    export const Refresh = 'refresh';
    export const SpinningLoader = 'loading~spin';
}

export const DEFAULT_INTERPRETER_SETTING = 'python';

export const isCI =
    process.env.TRAVIS === 'true' || process.env.TF_BUILD !== undefined || process.env.GITHUB_ACTIONS === 'true';

export function isTestExecution(): boolean {
    return process.env.VSC_PYTHON_CI_TEST === '1' || isUnitTestExecution();
}

/**
 * Whether we're running unit tests (*.unit.test.ts).
 * These tests have a special meaning, they run fast.
 */
export function isUnitTestExecution(): boolean {
    return process.env.VSC_PYTHON_UNIT_TEST === '1';
}

export const UseProposedApi = Symbol('USE_VSC_PROPOSED_API');

// --- Start Positron ---
export const IPYKERNEL_VERSION = '>=6.19.1';
export const MINIMUM_PYTHON_VERSION = { major: 3, minor: 8, patch: 0, raw: '3.8.0' } as PythonVersion;
// --- End Positron

export * from '../constants';
