import * as fs from 'fs-extra';
import * as path from 'path';
import { commands, l10n, MarkdownString, QuickInputButtons, Uri, window, workspace } from 'vscode';
import { PythonProject, PythonProjectCreator, PythonProjectCreatorOptions } from '../../api';
import { NEW_PROJECT_TEMPLATES_FOLDER } from '../../common/constants';
import { traceError } from '../../common/logging';
import { showInputBoxWithButtons, showTextDocument } from '../../common/window.apis';
import { PythonProjectManager } from '../../internal.api';
import { isCopilotInstalled, manageCopilotInstructionsFile, replaceInFilesAndNames } from './creationHelpers';

export class NewScriptProject implements PythonProjectCreator {
    public readonly name = l10n.t('newScript');
    public readonly displayName = l10n.t('Script');
    public readonly description = l10n.t('Creates a new script folder in your current workspace');
    public readonly tooltip = new MarkdownString(l10n.t('Create a new Python script'));

    constructor(private readonly projectManager: PythonProjectManager) {}

    async create(options?: PythonProjectCreatorOptions): Promise<PythonProject | Uri | undefined> {
        // quick create (needs name, will always create venv and copilot instructions)
        // not quick create
        // ask for script file name
        // ask if they want venv
        let scriptFileName = options?.name;
        let createCopilotInstructions: boolean | undefined;
        if (options?.quickCreate === true) {
            // If quickCreate is true, we should not prompt for any input
            if (!scriptFileName) {
                throw new Error('Script file name is required in quickCreate mode.');
            }
            createCopilotInstructions = true;
        } else {
            //Prompt as quickCreate is false
            if (!scriptFileName) {
                try {
                    scriptFileName = await showInputBoxWithButtons({
                        prompt: l10n.t('What is the name of the script? (e.g. my_script.py)'),
                        ignoreFocusOut: true,
                        showBackButton: true,
                        validateInput: (value) => {
                            // Ensure the filename ends with .py and follows valid naming conventions
                            if (!value.endsWith('.py')) {
                                return l10n.t('Script name must end with ".py".');
                            }
                            const baseName = value.replace(/\.py$/, '');
                            // following PyPI (PEP 508) rules for package names
                            if (!/^([a-z_]|[a-z0-9_][a-z0-9._-]*[a-z0-9_])$/i.test(baseName)) {
                                return l10n.t(
                                    'Invalid script name. Use only letters, numbers, underscores, hyphens, or periods. Must start and end with a letter or number.',
                                );
                            }
                            if (/^[-._0-9]$/i.test(baseName)) {
                                return l10n.t('Single-character script names cannot be a number, hyphen, or period.');
                            }
                            return null;
                        },
                    });
                } catch (ex) {
                    if (ex === QuickInputButtons.Back) {
                        await commands.executeCommand('python-envs.createNewProjectFromTemplate');
                    }
                }
                if (!scriptFileName) {
                    return undefined;
                }
                if (isCopilotInstalled()) {
                    createCopilotInstructions = true;
                }
            }

            // 1. Copy template folder
            const newScriptTemplateFile = path.join(NEW_PROJECT_TEMPLATES_FOLDER, 'new723ScriptTemplate', 'script.py');
            if (!(await fs.pathExists(newScriptTemplateFile))) {
                window.showErrorMessage(l10n.t('Template file does not exist, aborting creation.'));
                traceError(`Template file not found at: ${newScriptTemplateFile}`);
                return undefined;
            }

            // Check if the destination folder is provided, otherwise use the first workspace folder
            let destRoot = options?.rootUri.fsPath;
            if (!destRoot) {
                const workspaceFolders = workspace.workspaceFolders;
                if (!workspaceFolders || workspaceFolders.length === 0) {
                    window.showErrorMessage(l10n.t('No workspace folder is open or provided, aborting creation.'));
                    return undefined;
                }
                destRoot = workspaceFolders[0].uri.fsPath;
            }

            // Check if the destination folder already exists
            const scriptDestination = path.join(destRoot, scriptFileName);
            if (await fs.pathExists(scriptDestination)) {
                window.showErrorMessage(
                    l10n.t(
                        'A script file by that name already exists, aborting creation. Please retry with a unique script name given your workspace.',
                    ),
                );
                return undefined;
            }
            await fs.copy(newScriptTemplateFile, scriptDestination);

            // 2. Replace 'script_name' in the file using a helper (just script name remove .py)
            await replaceInFilesAndNames(scriptDestination, 'script_name', scriptFileName.replace(/\.py$/, ''));

            // 3. add custom github copilot instructions
            if (createCopilotInstructions) {
                const packageInstructionsPath = path.join(
                    NEW_PROJECT_TEMPLATES_FOLDER,
                    'copilot-instructions-text',
                    'script-copilot-instructions.md',
                );
                await manageCopilotInstructionsFile(destRoot, packageInstructionsPath, [
                    { searchValue: '<script_name>', replaceValue: scriptFileName },
                ]);
            }

            // Add the created script to the project manager
            const createdScript: PythonProject | undefined = {
                name: scriptFileName,
                uri: Uri.file(scriptDestination),
            };
            this.projectManager.add(createdScript);

            await showTextDocument(createdScript.uri);

            return createdScript;
        }
        return undefined;
    }
}
