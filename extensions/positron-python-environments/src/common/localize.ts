import { l10n } from 'vscode';
import { Commands } from './commands';

export namespace Common {
    export const recommended = l10n.t('Recommended');
    export const install = l10n.t('Install');
    export const uninstall = l10n.t('Uninstall');
    export const openInBrowser = l10n.t('Open in Browser');
    export const openInEditor = l10n.t('Open in Editor');
    export const browse = l10n.t('Browse');
    export const selectFolder = l10n.t('Select Folder');
    export const viewLogs = l10n.t('View Logs');
    export const yes = l10n.t('Yes');
    export const no = l10n.t('No');
    export const ok = l10n.t('Ok');
    export const quickCreate = l10n.t('Quick Create');
    export const installPython = l10n.t('Install Python');
}

export namespace WorkbenchStrings {
    export const installExtension = l10n.t('Install Extension');
}

export namespace Interpreter {
    export const statusBarSelect = l10n.t('Select Interpreter');
    export const browsePath = l10n.t('Browse...');
    export const createVirtualEnvironment = l10n.t('Create Virtual Environment...');
}

export namespace PackageManagement {
    export const install = l10n.t('Install');
    export const uninstall = l10n.t('Uninstall');
    export const installed = l10n.t('Installed');
    export const commonPackages = l10n.t('Common Packages');
    export const selectPackagesToInstall = l10n.t('Select packages to install');
    export const enterPackageNames = l10n.t('Enter package names');
    export const searchCommonPackages = l10n.t('Search `PyPI` packages');
    export const searchCommonPackagesDescription = l10n.t('Search and install popular `PyPI` packages');
    export const workspaceDependencies = l10n.t('Install project dependencies');
    export const workspaceDependenciesDescription = l10n.t('Install packages found in dependency files.');
    export const selectPackagesToUninstall = l10n.t('Select packages to uninstall');
    export const enterPackagesPlaceHolder = l10n.t('Enter package names separated by space');
    export const editArguments = l10n.t('Edit arguments');
    export const skipPackageInstallation = l10n.t('Skip package installation');
}

export namespace Pickers {
    export namespace Environments {
        export const selectExecutable = l10n.t('Select Python Executable');
        export const selectEnvironment = l10n.t('Select a Python Environment');
    }

    export namespace Packages {
        export const selectOption = l10n.t('Select an option');
    }

    export namespace Managers {
        export const selectEnvironmentManager = l10n.t('Select an environment manager');
        export const selectPackageManager = l10n.t('Select a package manager');
        export const selectProjectCreator = l10n.t('Select a project creator');
    }

    export namespace Project {
        export const selectProject = l10n.t('Select a project, folder or script');
        export const selectProjects = l10n.t('Select one or more projects, folders or scripts');
    }

    export namespace pyProject {
        export const validationErrorAction = l10n.t(' What would you like to do?');
        export const openFile = l10n.t('Open pyproject.toml');
        export const continueAnyway = l10n.t('Continue Anyway');
        export const cancel = l10n.t('Cancel');
    }
}

export namespace ProjectViews {
    export const noPackageManager = l10n.t('No package manager found');
    export const waitingForEnvManager = l10n.t('Waiting for environment managers to load');
    export const noEnvironmentManager = l10n.t('Environment manager not found');
    export const noEnvironmentManagerDescription = l10n.t(
        'Install an environment manager to get started. If you have installed then it might be loading or errored',
    );
    export const noEnvironmentProvided = l10n.t('No environment provided by:');
    export const noPackages = l10n.t('No packages found');
}

export namespace VenvManagerStrings {
    export const venvManagerDescription = l10n.t('Manages virtual environments created using `venv`');
    export const venvInitialize = l10n.t('Initializing virtual environments');
    export const venvRefreshing = l10n.t('Refreshing virtual environments');
    export const venvGlobalFolder = l10n.t('Select a folder to create a global virtual environment');
    export const venvGlobalFoldersSetting = l10n.t('Venv Folders Setting');

    export const venvErrorNoBasePython = l10n.t('No base Python found');
    export const venvErrorNoPython3 = l10n.t('Did not find any base Python 3');

    export const venvName = l10n.t('Enter a name for the virtual environment');
    export const venvNameErrorEmpty = l10n.t('Name cannot be empty');
    export const venvNameErrorExists = l10n.t('A folder with the same name already exists');
    export const venvCreateFailed = l10n.t('Failed to create virtual environment');

    export const venvRemoving = l10n.t('Removing virtual environment');
    export const venvRemoveFailed = l10n.t('Failed to remove virtual environment');
    export const venvRemoveInvalidPath = l10n.t(
        'Cannot remove: path does not appear to be a valid virtual environment',
    );
    export const venvRemoveUnsafePath = l10n.t('Cannot remove: path appears to be a system or root directory');

    export const installEditable = l10n.t('Install project as editable');
    export const searchingDependencies = l10n.t('Searching for dependencies');

    export const selectQuickOrCustomize = l10n.t('Select environment creation mode');
    export const quickCreate = l10n.t('Quick Create');
    export const quickCreateDescription = l10n.t('Create a virtual environment in the workspace root');
    export const customize = l10n.t('Custom');
    export const customizeDescription = l10n.t('Choose python version, location, packages, name, etc.');
}

export namespace SysManagerStrings {
    export const sysManagerDescription = l10n.t('Manages Global Python installs');
    export const sysManagerRefreshing = l10n.t('Refreshing Global Python interpreters');
    export const sysManagerDiscovering = l10n.t('Discovering Global Python interpreters');

    export const selectInstall = l10n.t('Select packages to install');
    export const selectUninstall = l10n.t('Select packages to uninstall');

    export const packageRefreshError = l10n.t('Error refreshing packages');
}

export namespace CondaStrings {
    export const condaManager = l10n.t('Manages Conda environments');
    export const condaDiscovering = l10n.t('Discovering Conda environments');
    export const condaRefreshingEnvs = l10n.t('Refreshing Conda environments');

    export const condaPackageMgr = l10n.t('Manages Conda packages');
    export const condaRefreshingPackages = l10n.t('Refreshing Conda packages');
    export const condaInstallingPackages = l10n.t('Installing Conda packages');
    export const condaInstallError = l10n.t('Error installing Conda packages');
    export const condaUninstallingPackages = l10n.t('Uninstalling Conda packages');
    export const condaUninstallError = l10n.t('Error uninstalling Conda packages');

    export const condaNamed = l10n.t('Named');
    export const condaPrefix = l10n.t('Prefix');

    export const condaNamedDescription = l10n.t('Create a named conda environment');
    export const condaPrefixDescription = l10n.t('Create environment in your workspace');
    export const condaSelectEnvType = l10n.t('Select the type of conda environment to create');

    export const condaNamedInput = l10n.t('Enter the name of the conda environment to create');

    export const condaCreateFailed = l10n.t('Failed to create conda environment');
    export const condaRemoveFailed = l10n.t('Failed to remove conda environment');
    export const condaExists = l10n.t('Environment already exists');

    export const quickCreateCondaNoEnvRoot = l10n.t('No conda environment root found');
    export const quickCreateCondaNoName = l10n.t('Could not generate a name for env');

    export const condaMissingPython = l10n.t('No Python found in the selected conda environment');
    export const condaMissingPythonNoFix = l10n.t(
        'No Python found in the selected conda environment. Please select another environment or install Python manually.',
    );
}

export namespace PyenvStrings {
    export const pyenvManager = l10n.t('Manages Pyenv Python versions');
    export const pyenvDiscovering = l10n.t('Discovering Pyenv Python versions');
    export const pyenvRefreshing = l10n.t('Refreshing Pyenv Python versions');
}

export namespace PipenvStrings {
    export const pipenvManager = l10n.t('Manages Pipenv environments');
    export const pipenvDiscovering = l10n.t('Discovering Pipenv environments');
    export const pipenvRefreshing = l10n.t('Refreshing Pipenv environments');
}

export namespace PoetryStrings {
    export const poetryManager = l10n.t('Manages Poetry environments');
    export const poetryDiscovering = l10n.t('Discovering Poetry environments');
    export const poetryRefreshing = l10n.t('Refreshing Poetry environments');
}

export namespace ProjectCreatorString {
    export const addExistingProjects = l10n.t('Add Existing Projects');
    export const autoFindProjects = l10n.t('Auto Find Projects');
    export const selectProjects = l10n.t('Select Python projects');
    export const selectFilesOrFolders = l10n.t('Select Project folders or Python files');
    export const autoFindProjectsDescription = l10n.t(
        'Automatically find folders with `pyproject.toml` or `setup.py` files.',
    );

    export const noProjectsFound = l10n.t('No projects found');
}

export namespace EnvViewStrings {
    export const selectedGlobalTooltip = l10n.t('This environment is selected for non-workspace files');
    export const selectedWorkspaceTooltip = l10n.t('This environment is selected for project files');
}

export namespace ActivationStrings {
    export const envCollectionDescription = l10n.t('Environment variables for shell activation');
    export const revertedShellStartupScripts = l10n.t(
        'Removed shell startup profile code for Python environment activation. See [logs](command:{0})',
        Commands.viewLogs,
    );
    export const activatingEnvironment = l10n.t('Activating environment');
}
