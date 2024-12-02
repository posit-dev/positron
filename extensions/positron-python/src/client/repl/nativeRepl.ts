// Native Repl class that holds instance of pythonServer and replController

import {
    NotebookController,
    NotebookControllerAffinity,
    NotebookDocument,
    QuickPickItem,
    TextEditor,
    workspace,
    WorkspaceFolder,
} from 'vscode';
import { Disposable } from 'vscode-jsonrpc';
import { PVSC_EXTENSION_ID } from '../common/constants';
import { showQuickPick } from '../common/vscodeApis/windowApis';
import { getWorkspaceFolders } from '../common/vscodeApis/workspaceApis';
import { PythonEnvironment } from '../pythonEnvironments/info';
import { createPythonServer, PythonServer } from './pythonServer';
import { executeNotebookCell, openInteractiveREPL, selectNotebookKernel } from './replCommandHandler';
import { createReplController } from './replController';
import { EventName } from '../telemetry/constants';
import { sendTelemetryEvent } from '../telemetry';
import { VariablesProvider } from './variables/variablesProvider';
import { VariableRequester } from './variables/variableRequester';

let nativeRepl: NativeRepl | undefined; // In multi REPL scenario, hashmap of URI to Repl.
export class NativeRepl implements Disposable {
    // Adding ! since it will get initialized in create method, not the constructor.
    private pythonServer!: PythonServer;

    private cwd: string | undefined;

    private interpreter!: PythonEnvironment;

    private disposables: Disposable[] = [];

    private replController!: NotebookController;

    private notebookDocument: NotebookDocument | undefined;

    public newReplSession: boolean | undefined = true;

    // TODO: In the future, could also have attribute of URI for file specific REPL.
    private constructor() {
        this.watchNotebookClosed();
    }

    // Static async factory method to handle asynchronous initialization
    public static async create(interpreter: PythonEnvironment): Promise<NativeRepl> {
        const nativeRepl = new NativeRepl();
        nativeRepl.interpreter = interpreter;
        await nativeRepl.setReplDirectory();
        nativeRepl.pythonServer = createPythonServer([interpreter.path as string], nativeRepl.cwd);
        nativeRepl.setReplController();

        return nativeRepl;
    }

    dispose(): void {
        this.disposables.forEach((d) => d.dispose());
    }

    /**
     * Function that watches for Notebook Closed event.
     * This is for the purposes of correctly updating the notebookEditor and notebookDocument on close.
     */
    private watchNotebookClosed(): void {
        this.disposables.push(
            workspace.onDidCloseNotebookDocument((nb) => {
                if (this.notebookDocument && nb.uri.toString() === this.notebookDocument.uri.toString()) {
                    this.notebookDocument = undefined;
                    this.newReplSession = true;
                }
            }),
        );
    }

    /**
     * Function that set up desired directory for REPL.
     * If there is multiple workspaces, prompt the user to choose
     * which directory we should set in context of native REPL.
     */
    private async setReplDirectory(): Promise<void> {
        // Figure out uri via workspaceFolder as uri parameter always
        // seem to be undefined from parameter when trying to access from replCommands.ts
        const workspaces: readonly WorkspaceFolder[] | undefined = getWorkspaceFolders();

        if (workspaces) {
            // eslint-disable-next-line no-shadow
            const workspacesQuickPickItems: QuickPickItem[] = workspaces.map((workspace) => ({
                label: workspace.name,
                description: workspace.uri.fsPath,
            }));

            if (workspacesQuickPickItems.length === 0) {
                this.cwd = process.cwd(); // Yields '/' on no workspace scenario.
            } else if (workspacesQuickPickItems.length === 1) {
                this.cwd = workspacesQuickPickItems[0].description;
            } else {
                // Show choices of workspaces for user to choose from.
                const selection = (await showQuickPick(workspacesQuickPickItems, {
                    placeHolder: 'Select current working directory for new REPL',
                    matchOnDescription: true,
                    ignoreFocusOut: true,
                })) as QuickPickItem;
                this.cwd = selection?.description;
            }
        }
    }

    /**
     * Function that check if NotebookController for REPL exists, and returns it in Singleton manner.
     */
    public setReplController(): NotebookController {
        if (!this.replController) {
            this.replController = createReplController(this.interpreter!.path, this.disposables, this.cwd);
            this.replController.variableProvider = new VariablesProvider(
                new VariableRequester(this.pythonServer),
                () => this.notebookDocument,
                this.pythonServer.onCodeExecuted,
            );
        }
        return this.replController;
    }

    /**
     * Function that checks if native REPL's text input box contains complete code.
     * @returns Promise<boolean> - True if complete/Valid code is present, False otherwise.
     */
    public async checkUserInputCompleteCode(activeEditor: TextEditor | undefined): Promise<boolean> {
        let completeCode = false;
        let userTextInput;
        if (activeEditor) {
            const { document } = activeEditor;
            userTextInput = document.getText();
        }

        // Check if userTextInput is a complete Python command
        if (userTextInput) {
            completeCode = await this.pythonServer.checkValidCommand(userTextInput);
        }

        return completeCode;
    }

    /**
     * Function that opens interactive repl, selects kernel, and send/execute code to the native repl.
     */
    public async sendToNativeRepl(code?: string): Promise<void> {
        const notebookEditor = await openInteractiveREPL(this.replController, this.notebookDocument);
        this.notebookDocument = notebookEditor.notebook;

        if (this.notebookDocument) {
            this.replController.updateNotebookAffinity(this.notebookDocument, NotebookControllerAffinity.Default);
            await selectNotebookKernel(notebookEditor, this.replController.id, PVSC_EXTENSION_ID);
            if (code) {
                await executeNotebookCell(notebookEditor, code);
            }
        }
    }
}

/**
 * Get Singleton Native REPL Instance
 * @param interpreter
 * @returns Native REPL instance
 */
export async function getNativeRepl(interpreter: PythonEnvironment, disposables: Disposable[]): Promise<NativeRepl> {
    if (!nativeRepl) {
        nativeRepl = await NativeRepl.create(interpreter);
        disposables.push(nativeRepl);
    }
    if (nativeRepl && nativeRepl.newReplSession) {
        sendTelemetryEvent(EventName.REPL, undefined, { replType: 'Native' });
        nativeRepl.newReplSession = false;
    }
    return nativeRepl;
}
