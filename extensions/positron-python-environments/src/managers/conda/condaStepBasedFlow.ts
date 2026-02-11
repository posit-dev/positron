import * as fse from 'fs-extra';
import * as path from 'path';
import { l10n, LogOutputChannel, QuickInputButtons, QuickPickItem, Uri } from 'vscode';
import { EnvironmentManager, PythonEnvironment, PythonEnvironmentApi } from '../../api';
import { CondaStrings } from '../../common/localize';
import { showInputBoxWithButtons, showQuickPickWithButtons } from '../../common/window.apis';
import {
    createNamedCondaEnvironment,
    createPrefixCondaEnvironment,
    getLocation,
    getName,
    trimVersionToMajorMinor,
} from './condaUtils';

// Recommended Python version for Conda environments
const RECOMMENDED_CONDA_PYTHON = '3.11.11';

/**
 * State interface for the Conda environment creation flow.
 *
 * This keeps track of all user selections throughout the flow,
 * allowing the wizard to maintain context when navigating backwards.
 */
interface CondaCreationState {
    // Type of Conda environment to create (named or prefix)
    envType?: string;

    // Python version to install in the environment
    pythonVersion?: string;

    // For named environments
    envName?: string;

    // For prefix environments
    prefix?: string;
    fsPath?: string;

    // Additional context
    uris?: Uri[];

    // API reference for Python environment operations
    api: PythonEnvironmentApi;
}

/**
 * Type definition for step functions in the wizard-like flow.
 *
 * Each step function:
 * 1. Takes the current state as input
 * 2. Interacts with the user through UI
 * 3. Updates the state with new data
 * 4. Returns the next step function to execute or null if flow is complete
 */
type StepFunction = (state: CondaCreationState) => Promise<StepFunction | null>;

/**
 * Step 1: Select environment type (named or prefix)
 */
async function selectEnvironmentType(state: CondaCreationState): Promise<StepFunction | null> {
    try {
        // Skip this step if we have multiple URIs (force named environment)
        if (state.uris && state.uris.length > 1) {
            state.envType = 'Named';
            return selectPythonVersion;
        }

        const selection = (await showQuickPickWithButtons(
            [
                { label: CondaStrings.condaNamed, description: CondaStrings.condaNamedDescription },
                { label: CondaStrings.condaPrefix, description: CondaStrings.condaPrefixDescription },
            ],
            {
                placeHolder: CondaStrings.condaSelectEnvType,
                ignoreFocusOut: true,
                showBackButton: true,
            },
        )) as QuickPickItem | undefined;

        if (!selection) {
            return null;
        }

        state.envType = selection.label;

        // Next step: select Python version
        return selectPythonVersion;
    } catch (ex) {
        if (ex === QuickInputButtons.Back) {
            // This is the first step, so return null to exit the flow
            return null;
        }
        throw ex;
    }
}

/**
 * Step 2: Select Python version
 */
async function selectPythonVersion(state: CondaCreationState): Promise<StepFunction | null> {
    try {
        const api = state.api;
        if (!api) {
            return null;
        }

        const envs = await api.getEnvironments('global');
        let versions = Array.from(
            new Set(
                envs
                    .map((env: PythonEnvironment) => env.version)
                    .filter(Boolean)
                    .map((v: string) => trimVersionToMajorMinor(v)), // cut to 3 digits
            ),
        );

        // Sort versions by major version (descending), ignoring minor/patch for simplicity
        const parseMajorMinor = (v: string) => {
            const m = v.match(/^(\\d+)(?:\\.(\\d+))?/);
            return { major: m ? Number(m[1]) : 0, minor: m && m[2] ? Number(m[2]) : 0 };
        };

        versions = versions.sort((a, b) => {
            const pa = parseMajorMinor(a as string);
            const pb = parseMajorMinor(b as string);
            if (pa.major !== pb.major) {
                return pb.major - pa.major;
            } // desc by major
            return pb.minor - pa.minor; // desc by minor
        });

        if (!versions || versions.length === 0) {
            versions = ['3.13', '3.12', '3.11', '3.10', '3.9'];
        }

        const items: QuickPickItem[] = versions.map((v: unknown) => ({
            label: v === RECOMMENDED_CONDA_PYTHON ? `$(star-full) Python` : 'Python',
            description: String(v),
        }));

        const selection = await showQuickPickWithButtons(items, {
            placeHolder: l10n.t('Select the version of Python to install in the environment'),
            matchOnDescription: true,
            ignoreFocusOut: true,
            showBackButton: true,
        });

        if (!selection) {
            return null;
        }

        state.pythonVersion = (selection as QuickPickItem).description;

        // Next step depends on environment type
        return state.envType === 'Named' ? enterEnvironmentName : selectLocation;
    } catch (ex) {
        if (ex === QuickInputButtons.Back) {
            // Go back to environment type selection
            return selectEnvironmentType;
        }
        throw ex;
    }
}

/**
 * Step 3a: Enter environment name (for named environments)
 */
async function enterEnvironmentName(state: CondaCreationState): Promise<StepFunction | null> {
    try {
        // Try to get a suggested name from project
        const suggestedName = getName(state.api, state.uris);

        const name = await showInputBoxWithButtons({
            prompt: CondaStrings.condaNamedInput,
            value: suggestedName,
            ignoreFocusOut: true,
            showBackButton: true,
        });

        if (!name) {
            return null;
        }

        state.envName = name;

        // Final step - proceed to create environment
        return null;
    } catch (ex) {
        if (ex === QuickInputButtons.Back) {
            // Go back to Python version selection
            return selectPythonVersion;
        }
        throw ex;
    }
}

/**
 * Step 3b: Select location (for prefix environments)
 */
async function selectLocation(state: CondaCreationState): Promise<StepFunction | null> {
    try {
        // Get location using imported getLocation helper
        const fsPath = await getLocation(state.api, state.uris || []);

        if (!fsPath) {
            return null;
        }

        state.fsPath = fsPath;

        // Next step: enter environment name
        return enterPrefixName;
    } catch (ex) {
        if (ex === QuickInputButtons.Back) {
            // Go back to Python version selection
            return selectPythonVersion;
        }
        throw ex;
    }
}

/**
 * Step 4: Enter prefix name (for prefix environments)
 */
async function enterPrefixName(state: CondaCreationState): Promise<StepFunction | null> {
    try {
        if (!state.fsPath) {
            return null;
        }

        let name = './.conda';
        const defaultPathExists = await fse.pathExists(path.join(state.fsPath, '.conda'));

        // If default name exists, ask for a new name
        if (defaultPathExists) {
            const newName = await showInputBoxWithButtons({
                prompt: l10n.t('Environment "{0}" already exists. Enter a different name', name),
                ignoreFocusOut: true,
                showBackButton: true,
                validateInput: async (value) => {
                    // Check if the proposed name already exists
                    if (!value) {
                        return l10n.t('Name cannot be empty');
                    }

                    // Get full path based on input
                    const fullPath = path.isAbsolute(value) ? value : path.join(state.fsPath!, value);

                    // Check if path exists
                    try {
                        if (await fse.pathExists(fullPath)) {
                            return CondaStrings.condaExists;
                        }
                    } catch (_) {
                        // Ignore file system errors during validation
                    }

                    return undefined;
                },
            });

            // If user cancels or presses escape
            if (!newName) {
                return null;
            }

            name = newName;
        }

        state.prefix = path.isAbsolute(name) ? name : path.join(state.fsPath, name);

        // Final step - proceed to create environment
        return null;
    } catch (ex) {
        if (ex === QuickInputButtons.Back) {
            // Go back to location selection
            return selectLocation;
        }
        throw ex;
    }
}

/**
 * Main entry point for the step-based Conda environment creation flow.
 *
 * This function implements a step-based wizard pattern for creating Conda
 * environments. This implementation allows users to navigate back to the immediately
 * previous step while preserving their selections.
 *
 * @param api Python Environment API
 * @param log Logger for recording operations
 * @param manager Environment manager
 * @param uris Optional URIs for determining the environment location
 * @returns The created environment or undefined if cancelled
 */
export async function createStepBasedCondaFlow(
    api: PythonEnvironmentApi,
    log: LogOutputChannel,
    manager: EnvironmentManager,
    uris?: Uri | Uri[],
): Promise<PythonEnvironment | undefined> {
    // Initialize the state object that will track user selections
    const state: CondaCreationState = {
        api: api,
        uris: Array.isArray(uris) ? uris : uris ? [uris] : [],
    };

    try {
        // Start with the first step
        let currentStep: StepFunction | null = selectEnvironmentType;

        // Execute steps until completion or cancellation
        while (currentStep !== null) {
            currentStep = await currentStep(state);
        }

        // If we have all required data, create the environment
        if (state.envType === CondaStrings.condaNamed && state.envName) {
            return await createNamedCondaEnvironment(api, log, manager, state.envName, state.pythonVersion);
        } else if (state.envType === CondaStrings.condaPrefix && state.prefix) {
            // For prefix environments, we need to pass the fsPath where the environment will be created
            return await createPrefixCondaEnvironment(api, log, manager, state.fsPath, state.pythonVersion);
        }

        // If we get here, the flow was likely cancelled
        return undefined;
    } catch (ex) {
        if (ex === QuickInputButtons.Back) {
            // This should not happen as back navigation is handled within each step
            // But if it does, restart the flow
            return await createStepBasedCondaFlow(api, log, manager, uris);
        }
        throw ex; // Re-throw other errors
    }
}
