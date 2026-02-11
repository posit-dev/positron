import * as fse from 'fs-extra';
import * as path from 'path';
import { LogOutputChannel, QuickInputButtons, Uri } from 'vscode';
import { EnvironmentManager, PythonEnvironment, PythonEnvironmentApi, PythonProject } from '../../api';
import { Pickers, VenvManagerStrings } from '../../common/localize';
import { EventNames } from '../../common/telemetry/constants';
import { sendTelemetryEvent } from '../../common/telemetry/sender';
import { showInputBoxWithButtons, showQuickPickWithButtons } from '../../common/window.apis';
import { NativePythonFinder } from '../common/nativePythonFinder';
import {
    getProjectInstallable,
    getWorkspacePackagesToInstall,
    PipPackages,
    shouldProceedAfterPyprojectValidation,
} from './pipUtils';
import { CreateEnvironmentResult, createWithProgress, ensureGlobalEnv } from './venvUtils';

/**
 * State interface for the venv creation flow.
 *
 * This keeps track of all user selections throughout the flow,
 * allowing the wizard to maintain context when navigating backwards.
 * Each property represents a piece of data collected during a step in the workflow.
 */
interface VenvCreationState {
    // Base Python environment to use for creating the venv
    basePython?: PythonEnvironment;

    // Whether to use quick create or custom create
    isQuickCreate?: boolean;

    // Name for the venv
    venvName?: string;

    // Packages to install in the venv
    // undefined = not yet set, null = user canceled during package selection
    packages?: PipPackages | null;

    // Store the sorted environments to avoid re-sorting when navigating back
    sortedEnvs?: PythonEnvironment[];

    // Tracks whether user completed the package selection step
    // undefined = not yet reached, true = completed, false = canceled
    packageSelectionCompleted?: boolean;

    // References to API and project needed for package selection
    api?: PythonEnvironmentApi;
    project?: PythonProject[];

    // Root directory where venv will be created (used for path validation)
    venvRoot?: Uri;
}
/**
 * Type definition for step functions in the wizard-like flow.
 *
 * Each step function:
 * 1. Takes the current state as input
 * 2. Interacts with the user through UI
 * 3. Updates the state with new data
 * 4. Returns the next step function to execute or null if flow is complete
 *
 * This pattern enables proper back navigation between steps without losing context.
 */
type StepFunction = (state: VenvCreationState) => Promise<StepFunction | null>;

/**
 * Step 1: Select quick create or custom create
 */
async function selectCreateType(state: VenvCreationState): Promise<StepFunction | null> {
    try {
        if (!state.sortedEnvs || state.sortedEnvs.length === 0) {
            return null;
        }

        // Show the quick/custom selection dialog with descriptive options
        const selection = await showQuickPickWithButtons(
            [
                {
                    label: VenvManagerStrings.quickCreate,
                    description: VenvManagerStrings.quickCreateDescription,
                    detail: `Uses Python version ${state.sortedEnvs[0].version} and installs workspace dependencies.`,
                },
                {
                    label: VenvManagerStrings.customize,
                    description: VenvManagerStrings.customizeDescription,
                },
            ],
            {
                placeHolder: VenvManagerStrings.selectQuickOrCustomize,
                ignoreFocusOut: true,
                showBackButton: true,
            },
        );

        // Handle cancellation - return null to exit the flow
        if (!selection || Array.isArray(selection)) {
            return null; // Exit the flow without creating an environment
        }

        if (selection.label === VenvManagerStrings.quickCreate) {
            // For quick create, use the first Python environment and proceed to completion
            state.isQuickCreate = true;
            state.basePython = state.sortedEnvs[0];
            // Quick create is complete - no more steps needed
            return null;
        } else {
            // For custom create, move to Python selection step
            state.isQuickCreate = false;
            // Next step: select base Python version
            return selectBasePython;
        }
    } catch (ex) {
        if (ex === QuickInputButtons.Back) {
            // This is the first step, so return null to exit the flow
            return null;
        }
        throw ex;
    }
}

/**
 * Step 2: Select base Python interpreter to use for venv creation
 */
async function selectBasePython(state: VenvCreationState): Promise<StepFunction | null> {
    try {
        if (!state.sortedEnvs || state.sortedEnvs.length === 0) {
            return null;
        }

        // Create items for each available Python environment with descriptive labels
        const items = state.sortedEnvs.map((e) => {
            const pathDescription = e.displayPath;
            const description =
                e.description && e.description.trim() ? `${e.description} (${pathDescription})` : pathDescription;

            return {
                label: e.displayName ?? e.name,
                description: description,
                e: e,
            };
        });

        // Show Python environment selection dialog with back button
        const selected = await showQuickPickWithButtons(items, {
            placeHolder: Pickers.Environments.selectEnvironment,
            ignoreFocusOut: true,
            showBackButton: true,
        });

        // Handle cancellation (Escape key or dialog close)
        if (!selected || Array.isArray(selected)) {
            return null; // Exit the flow without creating an environment
        }

        // Update state with selected Python environment
        const basePython = (selected as { e: PythonEnvironment }).e;
        if (!basePython || !basePython.execInfo) {
            // Invalid selection
            return null;
        }

        state.basePython = basePython;

        // Next step: input venv name
        return enterEnvironmentName;
    } catch (ex) {
        if (ex === QuickInputButtons.Back) {
            // Go back to create type selection if we came from there
            if (state.isQuickCreate !== undefined) {
                return selectCreateType;
            }
            return null;
        }
        throw ex;
    }
}

/**
 * Step 3: Enter environment name
 */
async function enterEnvironmentName(state: VenvCreationState): Promise<StepFunction | null> {
    try {
        // Show input box for venv name with back button
        const name = await showInputBoxWithButtons({
            prompt: VenvManagerStrings.venvName,
            value: '.venv', // Default name
            ignoreFocusOut: true,
            showBackButton: true,
            validateInput: async (value) => {
                if (!value) {
                    return VenvManagerStrings.venvNameErrorEmpty;
                }

                // Validate that the path doesn't already exist
                if (state.venvRoot) {
                    try {
                        const fullPath = path.join(state.venvRoot.fsPath, value);
                        if (await fse.pathExists(fullPath)) {
                            return VenvManagerStrings.venvNameErrorExists;
                        }
                    } catch (_) {
                        // Ignore file system errors during validation
                    }
                }
                return null;
            },
        });

        // Handle cancellation (Escape key or dialog close)
        if (!name) {
            return null; // Exit the flow without creating an environment
        }

        state.venvName = name;

        // Next step: select packages
        return selectPackages;
    } catch (ex) {
        if (ex === QuickInputButtons.Back) {
            // Go back to base Python selection
            return selectBasePython;
        }
        throw ex;
    }
}

/**
 * Step 4: Select packages to install
 */
async function selectPackages(state: VenvCreationState): Promise<StepFunction | null> {
    try {
        // Show package selection UI using existing function from pipUtils

        // Create packages structure with empty array and showing the skip option
        const packagesOptions = {
            showSkipOption: true,
            install: [],
        };

        // Use existing getWorkspacePackagesToInstall that will show the UI with all options
        // The function already handles showing workspace deps, PyPI options, and skip
        if (state.api) {
            const result = await getWorkspacePackagesToInstall(
                state.api,
                packagesOptions,
                state.project, // Use project from state if available
                undefined, // No environment yet since we're creating it
            );

            if (result !== undefined) {
                // User made a selection or clicked Skip
                state.packageSelectionCompleted = true;
                state.packages = result;
            } else {
                // User pressed Escape or closed the dialog
                state.packageSelectionCompleted = false;
                state.packages = null; // Explicitly mark as canceled
            }
        } else {
            // No API, can't show package selection
            state.packageSelectionCompleted = true;
            state.packages = {
                install: [],
                uninstall: [],
            };
        }

        // Final step - no more steps after this
        return null;
    } catch (ex) {
        if (ex === QuickInputButtons.Back) {
            // Go back to environment name input
            return enterEnvironmentName;
        }
        throw ex;
    }
}

/**
 * Main entry point for the step-based venv creation flow.
 *
 * This function implements a step-based wizard pattern for creating Python virtual
 * environments. The user can navigate through steps and also cancel at any point
 * by pressing Escape or closing any dialog.
 *
 * @param nativeFinder Python finder for resolving Python paths
 * @param api Python Environment API
 * @param log Logger for recording operations
 * @param manager Environment manager
 * @param basePythons Available Python environments
 * @param venvRoot Root directory where the venv will be created
 * @param options Configuration options
 * @returns The result of environment creation or undefined if cancelled at any point
 */
export async function createStepBasedVenvFlow(
    nativeFinder: NativePythonFinder,
    api: PythonEnvironmentApi,
    log: LogOutputChannel,
    manager: EnvironmentManager,
    basePythons: PythonEnvironment[],
    venvRoot: Uri,
    options: { showQuickAndCustomOptions: boolean; additionalPackages?: string[] },
): Promise<CreateEnvironmentResult | undefined> {
    // Sort and filter available Python environments
    const sortedEnvs = ensureGlobalEnv(basePythons, log);
    if (sortedEnvs.length === 0) {
        return {
            envCreationErr: 'No suitable Python environments found',
        };
    }

    // Initialize the state object that will track user selections
    const state: VenvCreationState = {
        sortedEnvs, // Store sorted environments in state to avoid re-sorting
        api, // Store API reference for package selection
        project: [api.getPythonProject(venvRoot)].filter(Boolean) as PythonProject[], // Get project for venvRoot
        venvRoot, // Store venvRoot for path validation
    };

    try {
        // Determine the first step based on options
        let currentStep: StepFunction | null = options.showQuickAndCustomOptions ? selectCreateType : selectBasePython;

        // Execute steps until completion or cancellation
        // When a step returns null, it means either:
        // 1. The step has completed successfully and there are no more steps
        // 2. The user cancelled the step (pressed Escape or closed the dialog)
        while (currentStep !== null) {
            currentStep = await currentStep(state);
        }

        // After workflow completes, check if we have all required data

        // Case 1: Quick create flow
        if (state.isQuickCreate && state.basePython) {
            // Use quick create flow
            sendTelemetryEvent(EventNames.VENV_CREATION, undefined, { creationType: 'quick' });
            // Use the default .venv name for quick create
            const quickEnvPath = path.join(venvRoot.fsPath, '.venv');

            // Get workspace dependencies to install
            const project = api.getPythonProject(venvRoot);
            const result = await getProjectInstallable(api, project ? [project] : undefined);
            const installables = result.installables;
            const allPackages = [];
            allPackages.push(...(installables?.flatMap((i) => i.args ?? []) ?? []));
            if (options.additionalPackages) {
                allPackages.push(...options.additionalPackages);
            }

            const validationError = result.validationError;
            const shouldProceed = await shouldProceedAfterPyprojectValidation(validationError, allPackages);
            if (!shouldProceed) {
                return undefined;
            }

            return await createWithProgress(nativeFinder, api, log, manager, state.basePython, venvRoot, quickEnvPath, {
                install: allPackages,
                uninstall: [],
            });
        }
        // Case 2: Custom create flow
        // Note: requires selectPackage step completed
        else if (
            !state.isQuickCreate &&
            state.basePython &&
            state.venvName &&
            // The user went through all steps without cancellation
            // (specifically checking that package selection wasn't canceled)
            state.packageSelectionCompleted !== false
        ) {
            sendTelemetryEvent(EventNames.VENV_CREATION, undefined, { creationType: 'custom' });

            const project = api.getPythonProject(venvRoot);
            const envPath = path.join(venvRoot.fsPath, state.venvName);

            // Get packages to install - if the selectPackages step was completed, state.packages might already be set
            // If not, we'll fetch packages here to ensure proper package detection
            let packages = state.packages;
            if (!packages) {
                packages = await getWorkspacePackagesToInstall(
                    api,
                    { showSkipOption: true, install: [] },
                    project ? [project] : undefined,
                    undefined,
                    log,
                );
            }

            // Combine packages from multiple sources
            const allPackages: string[] = [];

            // 1. User-selected packages from workspace dependencies or PyPI during the wizard flow
            // (may be undefined if user skipped package selection or canceled)
            if (packages?.install) {
                allPackages.push(...packages.install);
            }

            // 2. Additional packages provided by the caller of createStepBasedVenvFlow
            // (e.g., packages required by the extension itself)
            if (options.additionalPackages) {
                allPackages.push(...options.additionalPackages);
            }

            return await createWithProgress(nativeFinder, api, log, manager, state.basePython, venvRoot, envPath, {
                install: allPackages,
                uninstall: [],
            });
        }

        // If we get here, the flow was cancelled (e.g., user pressed Escape)
        // Return undefined to indicate no environment was created
        return undefined;
    } catch (ex) {
        if (ex === QuickInputButtons.Back) {
            // This should not happen as back navigation is handled within each step
            // But if it does, restart the flow
            return await createStepBasedVenvFlow(nativeFinder, api, log, manager, basePythons, venvRoot, options);
        }
        throw ex; // Re-throw other errors
    }
}
