// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { ChildProcess } from 'child_process';
import * as path from 'path';
import {
    CancellationToken,
    CancellationTokenSource,
    env,
    Event,
    EventEmitter,
    l10n,
    Position,
    Progress,
    ProgressLocation,
    ProgressOptions,
    QuickPickItem,
    Selection,
    TextEditorRevealType,
    Uri,
    ViewColumn,
    WebviewPanel,
    WebviewPanelOnDidChangeViewStateEvent,
    window,
    workspace,
} from 'vscode';
import * as fs from '../common/platform/fs-paths';
import { IApplicationShell, ICommandManager, IWorkspaceService } from '../common/application/types';
import { createPromiseFromCancellation } from '../common/cancellation';
import { tensorboardLauncher } from '../common/process/internal/scripts';
import { IPythonExecutionFactory, ObservableExecutionResult } from '../common/process/types';
import {
    IDisposableRegistry,
    IInstaller,
    InstallerResponse,
    ProductInstallStatus,
    Product,
    IPersistentState,
    IConfigurationService,
} from '../common/types';
import { createDeferred, sleep } from '../common/utils/async';
import { Common, TensorBoard } from '../common/utils/localize';
import { StopWatch } from '../common/utils/stopWatch';
import { IInterpreterService } from '../interpreter/contracts';
import { sendTelemetryEvent } from '../telemetry';
import { EventName } from '../telemetry/constants';
import { ImportTracker } from '../telemetry/importTracker';
import { TensorBoardPromptSelection, TensorBoardSessionStartResult } from './constants';
import { IMultiStepInputFactory } from '../common/utils/multiStepInput';
import { ModuleInstallFlags } from '../common/installer/types';
import { traceError, traceVerbose } from '../logging';

enum Messages {
    JumpToSource = 'jump_to_source',
}
const TensorBoardSemVerRequirement = '>= 2.4.1';
const TorchProfilerSemVerRequirement = '>= 0.2.0';

/**
 * Manages the lifecycle of a TensorBoard session.
 * Specifically, it:
 * - ensures the TensorBoard Python package is installed,
 * - asks the user for a log directory to start TensorBoard with
 * - spawns TensorBoard in a background process which must stay running
 *   to serve the TensorBoard website
 * - frames the TensorBoard website in a VSCode webview
 * - shuts down the TensorBoard process when the webview is closed
 */
export class TensorBoardSession {
    public get panel(): WebviewPanel | undefined {
        return this.webviewPanel;
    }

    public get daemon(): ChildProcess | undefined {
        return this.process;
    }

    private _active = false;

    private webviewPanel: WebviewPanel | undefined;

    private url: string | undefined;

    private process: ChildProcess | undefined;

    private onDidChangeViewStateEventEmitter = new EventEmitter<void>();

    private onDidDisposeEventEmitter = new EventEmitter<TensorBoardSession>();

    // This tracks the total duration of time that the user kept the TensorBoard panel open
    private sessionDurationStopwatch: StopWatch | undefined;

    constructor(
        private readonly installer: IInstaller,
        private readonly interpreterService: IInterpreterService,
        private readonly workspaceService: IWorkspaceService,
        private readonly pythonExecFactory: IPythonExecutionFactory,
        private readonly commandManager: ICommandManager,
        private readonly disposables: IDisposableRegistry,
        private readonly applicationShell: IApplicationShell,
        private readonly globalMemento: IPersistentState<ViewColumn>,
        private readonly multiStepFactory: IMultiStepInputFactory,
        private readonly configurationService: IConfigurationService,
    ) {
        this.disposables.push(this.onDidChangeViewStateEventEmitter);
        this.disposables.push(this.onDidDisposeEventEmitter);
    }

    public get onDidDispose(): Event<TensorBoardSession> {
        return this.onDidDisposeEventEmitter.event;
    }

    public get onDidChangeViewState(): Event<void> {
        return this.onDidChangeViewStateEventEmitter.event;
    }

    public get active(): boolean {
        return this._active;
    }

    public async refresh(): Promise<void> {
        if (!this.webviewPanel) {
            return;
        }
        this.webviewPanel.webview.html = '';
        this.webviewPanel.webview.html = await this.getHtml();
    }

    public async initialize(): Promise<void> {
        const e2eStartupDurationStopwatch = new StopWatch();
        const tensorBoardWasInstalled = await this.ensurePrerequisitesAreInstalled();
        if (!tensorBoardWasInstalled) {
            return;
        }
        const logDir = await this.getLogDirectory();
        if (!logDir) {
            return;
        }
        const startedSuccessfully = await this.startTensorboardSession(logDir);
        if (startedSuccessfully) {
            await this.showPanel();
            // Not using captureTelemetry on this method as we only want to send
            // this particular telemetry event if the whole session creation succeeded
            sendTelemetryEvent(
                EventName.TENSORBOARD_SESSION_E2E_STARTUP_DURATION,
                e2eStartupDurationStopwatch.elapsedTime,
            );
        }
        this.sessionDurationStopwatch = new StopWatch();
    }

    private async promptToInstall(
        tensorBoardInstallStatus: ProductInstallStatus,
        profilerPluginInstallStatus: ProductInstallStatus,
    ) {
        sendTelemetryEvent(EventName.TENSORBOARD_INSTALL_PROMPT_SHOWN);
        const yes = Common.bannerLabelYes;
        const no = Common.bannerLabelNo;
        const isUpgrade = tensorBoardInstallStatus === ProductInstallStatus.NeedsUpgrade;
        let message;

        if (
            tensorBoardInstallStatus === ProductInstallStatus.Installed &&
            profilerPluginInstallStatus !== ProductInstallStatus.Installed
        ) {
            // PyTorch user already has TensorBoard, just ask if they want the profiler plugin
            message = TensorBoard.installProfilerPluginPrompt;
        } else if (profilerPluginInstallStatus !== ProductInstallStatus.Installed) {
            // PyTorch user doesn't have compatible TensorBoard or the profiler plugin
            message = TensorBoard.installTensorBoardAndProfilerPluginPrompt;
        } else if (isUpgrade) {
            // Not a PyTorch user and needs upgrade, don't need to mention profiler plugin
            message = TensorBoard.upgradePrompt;
        } else {
            // Not a PyTorch user and needs install, again don't need to mention profiler plugin
            message = TensorBoard.installPrompt;
        }
        const selection = await this.applicationShell.showErrorMessage(message, ...[yes, no]);
        let telemetrySelection = TensorBoardPromptSelection.None;
        if (selection === yes) {
            telemetrySelection = TensorBoardPromptSelection.Yes;
        } else if (selection === no) {
            telemetrySelection = TensorBoardPromptSelection.No;
        }
        sendTelemetryEvent(EventName.TENSORBOARD_INSTALL_PROMPT_SELECTION, undefined, {
            selection: telemetrySelection,
            operationType: isUpgrade ? 'upgrade' : 'install',
        });
        return selection;
    }

    // Ensure that the TensorBoard package is installed before we attempt
    // to start a TensorBoard session. If the user has a torch import in
    // any of their open documents, also try to install the torch-tb-plugin
    // package, but don't block if installing that fails.
    public async ensurePrerequisitesAreInstalled(resource?: Uri): Promise<boolean> {
        traceVerbose('Ensuring TensorBoard package is installed into active interpreter');
        const interpreter =
            (await this.interpreterService.getActiveInterpreter(resource)) ||
            (await this.commandManager.executeCommand('python.setInterpreter'));
        if (!interpreter) {
            return false;
        }

        // First see what dependencies we're missing
        let [tensorboardInstallStatus, profilerPluginInstallStatus] = await Promise.all([
            this.installer.isProductVersionCompatible(Product.tensorboard, TensorBoardSemVerRequirement, interpreter),
            this.installer.isProductVersionCompatible(
                Product.torchProfilerImportName,
                TorchProfilerSemVerRequirement,
                interpreter,
            ),
        ]);
        const isTorchUser = ImportTracker.hasModuleImport('torch');
        const needsTensorBoardInstall = tensorboardInstallStatus !== ProductInstallStatus.Installed;
        const needsProfilerPluginInstall = profilerPluginInstallStatus !== ProductInstallStatus.Installed;
        if (
            // PyTorch user, in profiler install experiment, TensorBoard and profiler plugin already installed
            (isTorchUser && !needsTensorBoardInstall && !needsProfilerPluginInstall) ||
            // Not PyTorch user or not in profiler install experiment, so no need for profiler plugin,
            // and TensorBoard is already installed
            (!isTorchUser && tensorboardInstallStatus === ProductInstallStatus.Installed)
        ) {
            return true;
        }

        // Ask the user if they want to install packages to start a TensorBoard session
        const selection = await this.promptToInstall(
            tensorboardInstallStatus,
            isTorchUser ? profilerPluginInstallStatus : ProductInstallStatus.Installed,
        );
        if (selection !== Common.bannerLabelYes && !needsTensorBoardInstall) {
            return true;
        }
        if (selection !== Common.bannerLabelYes) {
            return false;
        }

        // User opted to install packages. Figure out which ones we need and install them
        const tokenSource = new CancellationTokenSource();
        const installerToken = tokenSource.token;
        const cancellationPromise = createPromiseFromCancellation({
            cancelAction: 'resolve',
            defaultValue: InstallerResponse.Ignore,
            token: installerToken,
        });
        const installPromises = [];
        // If need to install torch.profiler and it's not already installed, add it to our list of promises
        if (needsTensorBoardInstall) {
            installPromises.push(
                this.installer.install(
                    Product.tensorboard,
                    interpreter,
                    installerToken,
                    tensorboardInstallStatus === ProductInstallStatus.NeedsUpgrade
                        ? ModuleInstallFlags.upgrade
                        : undefined,
                ),
            );
        }
        if (isTorchUser && needsProfilerPluginInstall) {
            installPromises.push(
                this.installer.install(
                    Product.torchProfilerInstallName,
                    interpreter,
                    installerToken,
                    profilerPluginInstallStatus === ProductInstallStatus.NeedsUpgrade
                        ? ModuleInstallFlags.upgrade
                        : undefined,
                ),
            );
        }
        await Promise.race([...installPromises, cancellationPromise]);

        // Check install status again after installing
        [tensorboardInstallStatus, profilerPluginInstallStatus] = await Promise.all([
            this.installer.isProductVersionCompatible(Product.tensorboard, TensorBoardSemVerRequirement, interpreter),
            this.installer.isProductVersionCompatible(
                Product.torchProfilerImportName,
                TorchProfilerSemVerRequirement,
                interpreter,
            ),
        ]);
        // Send telemetry regarding results of install
        sendTelemetryEvent(EventName.TENSORBOARD_PACKAGE_INSTALL_RESULT, undefined, {
            wasTensorBoardAttempted: needsTensorBoardInstall,
            wasProfilerPluginAttempted: needsProfilerPluginInstall,
            wasTensorBoardInstalled: tensorboardInstallStatus === ProductInstallStatus.Installed,
            wasProfilerPluginInstalled: profilerPluginInstallStatus === ProductInstallStatus.Installed,
        });
        // Profiler plugin is not required to start TensorBoard. If it failed, note that it failed
        // in the log, but report success only based on TensorBoard package install status.
        if (isTorchUser && profilerPluginInstallStatus !== ProductInstallStatus.Installed) {
            traceError(`Failed to install torch-tb-plugin. Profiler plugin will not appear in TensorBoard session.`);
        }
        return tensorboardInstallStatus === ProductInstallStatus.Installed;
    }

    private async showFilePicker(): Promise<string | undefined> {
        const selection = await this.applicationShell.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
        });
        // If the user selected a folder, return the uri.fsPath
        // There will only be one selection since canSelectMany: false
        if (selection) {
            return selection[0].fsPath;
        }
        return undefined;
    }

    // eslint-disable-next-line class-methods-use-this
    private getQuickPickItems(logDir: string | undefined) {
        const items = [];

        if (logDir) {
            const useCwd = {
                label: TensorBoard.useCurrentWorkingDirectory,
                detail: TensorBoard.useCurrentWorkingDirectoryDetail,
            };
            const selectAnotherFolder = {
                label: TensorBoard.selectAnotherFolder,
                detail: TensorBoard.selectAnotherFolderDetail,
            };
            items.push(useCwd, selectAnotherFolder);
        } else {
            const selectAFolder = {
                label: TensorBoard.selectAFolder,
                detail: TensorBoard.selectAFolderDetail,
            };
            items.push(selectAFolder);
        }

        items.push({
            label: TensorBoard.enterRemoteUrl,
            detail: TensorBoard.enterRemoteUrlDetail,
        });

        return items;
    }

    // Display a quickpick asking the user to acknowledge our autopopulated log directory or
    // select a new one using the file picker. Default this to the folder that is open in
    // the editor, if any, then the directory that the active text editor is in, if any.
    private async getLogDirectory(): Promise<string | undefined> {
        // See if the user told us to always use a specific log directory
        const settings = this.configurationService.getSettings();
        const settingValue = settings.tensorBoard?.logDirectory;
        if (settingValue) {
            traceVerbose(`Using log directory resolved by python.tensorBoard.logDirectory setting: ${settingValue}`);
            return settingValue;
        }
        // No log directory in settings. Ask the user which directory to use
        const logDir = this.autopopulateLogDirectoryPath();
        const { useCurrentWorkingDirectory } = TensorBoard;
        const { selectAFolder } = TensorBoard;
        const { selectAnotherFolder } = TensorBoard;
        const { enterRemoteUrl } = TensorBoard;
        const items: QuickPickItem[] = this.getQuickPickItems(logDir);
        const item = await this.applicationShell.showQuickPick(items, {
            canPickMany: false,
            ignoreFocusOut: false,
            placeHolder: logDir ? l10n.t('Current: {0}', logDir) : undefined,
        });
        switch (item?.label) {
            case useCurrentWorkingDirectory:
                return logDir;
            case selectAFolder:
            case selectAnotherFolder:
                return this.showFilePicker();
            case enterRemoteUrl:
                return this.applicationShell.showInputBox({
                    prompt: TensorBoard.enterRemoteUrlDetail,
                });
            default:
                return undefined;
        }
    }

    // Spawn a process which uses TensorBoard's Python API to start a TensorBoard session.
    // Times out if it hasn't started up after 1 minute.
    // Hold on to the process so we can kill it when the webview is closed.
    private async startTensorboardSession(logDir: string): Promise<boolean> {
        const interpreter = await this.interpreterService.getActiveInterpreter();
        if (!interpreter) {
            return false;
        }

        // Timeout waiting for TensorBoard to start after 60 seconds.
        // This is the same time limit that TensorBoard itself uses when waiting for
        // its webserver to start up.
        const timeout = 60_000;

        // Display a progress indicator as TensorBoard takes at least a couple seconds to launch
        const progressOptions: ProgressOptions = {
            title: TensorBoard.progressMessage,
            location: ProgressLocation.Notification,
            cancellable: true,
        };

        const processService = await this.pythonExecFactory.createActivatedEnvironment({
            allowEnvironmentFetchExceptions: true,
            interpreter,
        });
        const args = tensorboardLauncher([logDir]);
        const sessionStartStopwatch = new StopWatch();
        const observable = processService.execObservable(args, {});

        const result = await this.applicationShell.withProgress(
            progressOptions,
            (_progress: Progress<unknown>, token: CancellationToken) => {
                traceVerbose(`Starting TensorBoard with log directory ${logDir}...`);

                const spawnTensorBoard = this.waitForTensorBoardStart(observable);
                const userCancellation = createPromiseFromCancellation({
                    token,
                    cancelAction: 'resolve',
                    defaultValue: 'canceled',
                });

                return Promise.race([sleep(timeout), spawnTensorBoard, userCancellation]);
            },
        );

        switch (result) {
            case 'canceled':
                traceVerbose('Canceled starting TensorBoard session.');
                sendTelemetryEvent(
                    EventName.TENSORBOARD_SESSION_DAEMON_STARTUP_DURATION,
                    sessionStartStopwatch.elapsedTime,
                    {
                        result: TensorBoardSessionStartResult.cancel,
                    },
                );
                observable.dispose();
                return false;
            case 'success':
                this.process = observable.proc;
                sendTelemetryEvent(
                    EventName.TENSORBOARD_SESSION_DAEMON_STARTUP_DURATION,
                    sessionStartStopwatch.elapsedTime,
                    {
                        result: TensorBoardSessionStartResult.success,
                    },
                );
                return true;
            case timeout:
                sendTelemetryEvent(
                    EventName.TENSORBOARD_SESSION_DAEMON_STARTUP_DURATION,
                    sessionStartStopwatch.elapsedTime,
                    {
                        result: TensorBoardSessionStartResult.error,
                    },
                );
                throw new Error(`Timed out after ${timeout / 1000} seconds waiting for TensorBoard to launch.`);
            default:
                // We should never get here
                throw new Error(`Failed to start TensorBoard, received unknown promise result: ${result}`);
        }
    }

    private async waitForTensorBoardStart(observable: ObservableExecutionResult<string>) {
        const urlThatTensorBoardIsRunningAt = createDeferred<string>();

        observable.out.subscribe({
            next: (output) => {
                if (output.source === 'stdout') {
                    const match = output.out.match(/TensorBoard started at (.*)/);
                    if (match && match[1]) {
                        // eslint-disable-next-line prefer-destructuring
                        this.url = match[1];
                        urlThatTensorBoardIsRunningAt.resolve('success');
                    }
                    traceVerbose(output.out);
                } else if (output.source === 'stderr') {
                    traceError(output.out);
                }
            },
            error: (err) => {
                traceError(err);
            },
        });

        return urlThatTensorBoardIsRunningAt.promise;
    }

    private async showPanel() {
        traceVerbose('Showing TensorBoard panel');
        const panel = this.webviewPanel || (await this.createPanel());
        panel.reveal();
        this._active = true;
        this.onDidChangeViewStateEventEmitter.fire();
    }

    private async createPanel() {
        const webviewPanel = window.createWebviewPanel('tensorBoardSession', 'TensorBoard', this.globalMemento.value, {
            enableScripts: true,
            retainContextWhenHidden: true,
        });
        webviewPanel.webview.html = await this.getHtml();
        this.webviewPanel = webviewPanel;
        this.disposables.push(
            webviewPanel.onDidDispose(() => {
                this.webviewPanel = undefined;
                // Kill the running TensorBoard session
                this.process?.kill();
                sendTelemetryEvent(EventName.TENSORBOARD_SESSION_DURATION, this.sessionDurationStopwatch?.elapsedTime);
                this.process = undefined;
                this._active = false;
                this.onDidDisposeEventEmitter.fire(this);
            }),
        );
        this.disposables.push(
            webviewPanel.onDidChangeViewState(async (args: WebviewPanelOnDidChangeViewStateEvent) => {
                // The webview has been moved to a different viewgroup if it was active before and remains active now
                if (this.active && args.webviewPanel.active) {
                    await this.globalMemento.updateValue(webviewPanel.viewColumn ?? ViewColumn.Active);
                }
                this._active = args.webviewPanel.active;
                this.onDidChangeViewStateEventEmitter.fire();
            }),
        );
        this.disposables.push(
            webviewPanel.webview.onDidReceiveMessage((message) => {
                // Handle messages posted from the webview
                switch (message.command) {
                    case Messages.JumpToSource:
                        void this.jumpToSource(message.args.filename, message.args.line);
                        break;
                    default:
                        break;
                }
            }),
        );
        return webviewPanel;
    }

    private autopopulateLogDirectoryPath(): string | undefined {
        if (this.workspaceService.rootPath) {
            return this.workspaceService.rootPath;
        }
        const { activeTextEditor } = window;
        if (activeTextEditor) {
            return path.dirname(activeTextEditor.document.uri.fsPath);
        }
        return undefined;
    }

    private async jumpToSource(fsPath: string, line: number) {
        sendTelemetryEvent(EventName.TENSORBOARD_JUMP_TO_SOURCE_REQUEST);
        let uri: Uri | undefined;
        if (fs.existsSync(fsPath)) {
            uri = Uri.file(fsPath);
        } else {
            sendTelemetryEvent(EventName.TENSORBOARD_JUMP_TO_SOURCE_FILE_NOT_FOUND);
            traceError(
                `Requested jump to source filepath ${fsPath} does not exist. Prompting user to select source file...`,
            );
            // Prompt the user to pick the file on disk
            const items: QuickPickItem[] = [
                {
                    label: TensorBoard.selectMissingSourceFile,
                    description: TensorBoard.selectMissingSourceFileDescription,
                },
            ];
            // Using a multistep so that we can add a title to the quickpick
            const multiStep = this.multiStepFactory.create<unknown>();
            await multiStep.run(async (input) => {
                const selection = await input.showQuickPick({
                    items,
                    title: TensorBoard.missingSourceFile,
                    placeholder: fsPath,
                });
                switch (selection?.label) {
                    case TensorBoard.selectMissingSourceFile: {
                        const filePickerSelection = await this.applicationShell.showOpenDialog({
                            canSelectFiles: true,
                            canSelectFolders: false,
                            canSelectMany: false,
                        });
                        if (filePickerSelection !== undefined) {
                            [uri] = filePickerSelection;
                        }
                        break;
                    }
                    default:
                        break;
                }
            }, {});
        }
        if (uri === undefined) {
            return;
        }
        const document = await workspace.openTextDocument(uri);
        const editor = await window.showTextDocument(document, ViewColumn.Beside);
        // Select the line if it exists in the document
        if (line < editor.document.lineCount) {
            const position = new Position(line, 0);
            const selection = new Selection(position, editor.document.lineAt(line).range.end);
            editor.selection = selection;
            editor.revealRange(selection, TextEditorRevealType.InCenterIfOutsideViewport);
        }
    }

    private async getHtml() {
        // We cannot cache the result of calling asExternalUri, so regenerate
        // it each time. From docs: "Note that extensions should not cache the
        // result of asExternalUri as the resolved uri may become invalid due
        // to a system or user action — for example, in remote cases, a user may
        // close a port forwarding tunnel that was opened by asExternalUri."
        const fullWebServerUri = await env.asExternalUri(Uri.parse(this.url!));
        return `<!DOCTYPE html>
        <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" content="default-src 'unsafe-inline'; frame-src ${fullWebServerUri} http: https:;">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>TensorBoard</title>
            </head>
            <body>
                <script type="text/javascript">
                    (function() {
                        const vscode = acquireVsCodeApi();
                        function resizeFrame() {
                            var f = window.document.getElementById('vscode-tensorboard-iframe');
                            if (f) {
                                f.style.height = window.innerHeight / 0.8 + "px";
                                f.style.width = window.innerWidth / 0.8 + "px";
                            }
                        }
                        window.onload = function() {
                            resizeFrame();
                        }
                        window.addEventListener('resize', resizeFrame);
                        window.addEventListener('message', (event) => {
                            if (!"${fullWebServerUri}".startsWith(event.origin) || !event.data || !event.data.filename || !event.data.line) {
                                return;
                            }
                            const args = { filename: event.data.filename, line: event.data.line };
                            vscode.postMessage({ command: '${Messages.JumpToSource}', args: args });
                        });
                    }())
                </script>
                <iframe
                    id="vscode-tensorboard-iframe"
                    class="responsive-iframe"
                    sandbox="allow-scripts allow-forms allow-same-origin allow-pointer-lock"
                    src="${fullWebServerUri}"
                    frameborder="0"
                    border="0"
                    allowfullscreen
                ></iframe>
                <style>
                    .responsive-iframe {
                        transform: scale(0.8);
                        transform-origin: 0 0;
                        position: absolute;
                        top: 0;
                        left: 0;
                        overflow: hidden;
                        display: block;
                        width: 100%;
                        height: 100%;
                    }
                </style>
            </body>
        </html>`;
    }
}
