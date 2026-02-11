/* eslint-disable @typescript-eslint/no-explicit-any */
import {
    CancellationToken,
    Disposable,
    ExtensionTerminalOptions,
    FileDecorationProvider,
    InputBox,
    InputBoxOptions,
    LogOutputChannel,
    MessageItem,
    MessageOptions,
    OpenDialogOptions,
    OutputChannel,
    Progress,
    ProgressOptions,
    QuickInputButton,
    QuickInputButtons,
    QuickPick,
    QuickPickItem,
    QuickPickItemButtonEvent,
    QuickPickOptions,
    StatusBarAlignment,
    StatusBarItem,
    Terminal,
    TerminalOptions,
    TerminalShellExecutionEndEvent,
    TerminalShellExecutionStartEvent,
    TerminalShellIntegrationChangeEvent,
    TextEditor,
    Uri,
    window,
    WindowState,
} from 'vscode';
import { createDeferred } from './utils/deferred';

export function createStatusBarItem(id: string, alignment?: StatusBarAlignment, priority?: number): StatusBarItem {
    return window.createStatusBarItem(id, alignment, priority);
}

export function createTerminal(options: ExtensionTerminalOptions | TerminalOptions): Terminal {
    return window.createTerminal(options);
}

export function onDidChangeTerminalShellIntegration(
    listener: (e: TerminalShellIntegrationChangeEvent) => any,
    thisArgs?: any,
    disposables?: Disposable[],
): Disposable {
    return window.onDidChangeTerminalShellIntegration(listener, thisArgs, disposables);
}

export function onDidWriteTerminalData(
    listener: (e: { readonly terminal: Terminal; readonly data: string }) => any,
    thisArgs?: any,
    disposables?: Disposable[],
): Disposable {
    return window.onDidWriteTerminalData(listener, thisArgs, disposables);
}

export function showOpenDialog(options?: OpenDialogOptions): Thenable<Uri[] | undefined> {
    return window.showOpenDialog(options);
}

export function terminals(): readonly Terminal[] {
    return window.terminals;
}

export function activeTerminal(): Terminal | undefined {
    return window.activeTerminal;
}

export function activeTerminalShellIntegration() {
    return window.activeTerminal?.shellIntegration;
}

export function activeTextEditor(): TextEditor | undefined {
    return window.activeTextEditor;
}

export function onDidChangeActiveTerminal(
    listener: (e: Terminal | undefined) => any,
    thisArgs?: any,
    disposables?: Disposable[],
): Disposable {
    return window.onDidChangeActiveTerminal(listener, thisArgs, disposables);
}

export function onDidChangeActiveTextEditor(
    listener: (e: TextEditor | undefined) => any,
    thisArgs?: any,
    disposables?: Disposable[],
): Disposable {
    return window.onDidChangeActiveTextEditor(listener, thisArgs, disposables);
}

export function onDidStartTerminalShellExecution(
    listener: (e: TerminalShellExecutionStartEvent) => any,
    thisArgs?: any,
    disposables?: Disposable[],
): Disposable {
    return window.onDidStartTerminalShellExecution(listener, thisArgs, disposables);
}

export function onDidEndTerminalShellExecution(
    listener: (e: TerminalShellExecutionEndEvent) => any,
    thisArgs?: any,
    disposables?: Disposable[],
): Disposable {
    return window.onDidEndTerminalShellExecution(listener, thisArgs, disposables);
}

export function onDidOpenTerminal(
    listener: (terminal: Terminal) => any,
    thisArgs?: any,
    disposables?: Disposable[],
): Disposable {
    return window.onDidOpenTerminal(listener, thisArgs, disposables);
}

export function onDidCloseTerminal(
    listener: (terminal: Terminal) => any,
    thisArgs?: any,
    disposables?: Disposable[],
): Disposable {
    return window.onDidCloseTerminal(listener, thisArgs, disposables);
}

export function onDidChangeTerminalState(
    listener: (e: Terminal) => any,
    thisArgs?: any,
    disposables?: Disposable[],
): Disposable {
    return window.onDidChangeTerminalState(listener, thisArgs, disposables);
}

export function showTextDocument(uri: Uri): Thenable<TextEditor> {
    return window.showTextDocument(uri);
}

export interface QuickPickButtonEvent<T extends QuickPickItem> {
    readonly item: T | readonly T[] | undefined;
    readonly button: QuickInputButton;
}

export function showQuickPick<T extends QuickPickItem>(
    items: readonly T[] | Thenable<readonly T[]>,
    options?: QuickPickOptions,
    token?: CancellationToken,
): Thenable<T | undefined> {
    return window.showQuickPick(items, options, token);
}

export function withProgress<R>(
    options: ProgressOptions,
    task: (
        progress: Progress<{
            message?: string;
            increment?: number;
        }>,
        token: CancellationToken,
    ) => Thenable<R>,
): Thenable<R> {
    return window.withProgress(options, task);
}

export async function showQuickPickWithButtons<T extends QuickPickItem>(
    items: readonly T[],
    options?: QuickPickOptions & { showBackButton?: boolean; buttons?: QuickInputButton[]; selected?: T[] },
    token?: CancellationToken,
    itemButtonHandler?: (e: QuickPickItemButtonEvent<T>) => void,
): Promise<T | T[] | undefined> {
    const quickPick: QuickPick<T> = window.createQuickPick<T>();
    const disposables: Disposable[] = [quickPick];
    const deferred = createDeferred<T | T[] | undefined>();

    quickPick.items = items;
    quickPick.canSelectMany = options?.canPickMany ?? false;
    quickPick.ignoreFocusOut = options?.ignoreFocusOut ?? false;
    quickPick.matchOnDescription = options?.matchOnDescription ?? false;
    quickPick.matchOnDetail = options?.matchOnDetail ?? false;
    quickPick.placeholder = options?.placeHolder;
    quickPick.title = options?.title;
    quickPick.selectedItems = options?.selected ?? [];

    if (options?.showBackButton) {
        quickPick.buttons = [QuickInputButtons.Back];
    }

    if (options?.buttons) {
        quickPick.buttons = [...quickPick.buttons, ...options.buttons];
    }

    disposables.push(
        quickPick.onDidTriggerButton((button) => {
            if (button === QuickInputButtons.Back) {
                deferred.reject(QuickInputButtons.Back);
                quickPick.hide();
            } else if (options?.buttons?.includes(button)) {
                deferred.reject({ item: quickPick.selectedItems, button });
                quickPick.hide();
            }
        }),
        quickPick.onDidAccept(() => {
            if (!deferred.completed) {
                if (quickPick.canSelectMany) {
                    deferred.resolve(quickPick.selectedItems.map((item) => item));
                } else {
                    deferred.resolve(quickPick.selectedItems[0]);
                }

                quickPick.hide();
            }
        }),
        quickPick.onDidHide(() => {
            if (!deferred.completed) {
                deferred.resolve(undefined);
            }
        }),
        quickPick.onDidTriggerItemButton((e) => {
            if (itemButtonHandler) {
                itemButtonHandler(e);
            }
        }),
    );
    if (token) {
        disposables.push(
            token.onCancellationRequested(() => {
                quickPick.hide();
            }),
        );
    }
    quickPick.show();

    try {
        return await deferred.promise;
    } finally {
        disposables.forEach((d) => d.dispose());
    }
}

export async function showInputBoxWithButtons(
    options?: InputBoxOptions & { showBackButton?: boolean },
): Promise<string | undefined> {
    const inputBox: InputBox = window.createInputBox();
    const disposables: Disposable[] = [inputBox];
    const deferred = createDeferred<string | undefined>();

    inputBox.placeholder = options?.placeHolder;
    inputBox.title = options?.title;
    inputBox.value = options?.value ?? '';
    inputBox.ignoreFocusOut = options?.ignoreFocusOut ?? false;
    inputBox.password = options?.password ?? false;
    inputBox.prompt = options?.prompt;

    if (options?.valueSelection) {
        inputBox.valueSelection = options?.valueSelection;
    }

    if (options?.showBackButton) {
        inputBox.buttons = [QuickInputButtons.Back];
    }

    disposables.push(
        inputBox.onDidTriggerButton((button) => {
            if (button === QuickInputButtons.Back) {
                deferred.reject(QuickInputButtons.Back);
                inputBox.hide();
            }
        }),
        inputBox.onDidAccept(async () => {
            if (!deferred.completed) {
                let isValid = true;
                if (options?.validateInput) {
                    const validation = await options.validateInput(inputBox.value);
                    isValid = validation === null || validation === undefined;
                    if (!isValid) {
                        inputBox.validationMessage = typeof validation === 'string' ? validation : 'Invalid input';
                        return; // Do not resolve, keep the input box open
                    }
                }
                deferred.resolve(inputBox.value);
                inputBox.hide();
            }
        }),
        inputBox.onDidHide(() => {
            if (!deferred.completed) {
                deferred.resolve(undefined);
            }
        }),
        inputBox.onDidChangeValue(async (value) => {
            if (options?.validateInput) {
                const validation = await options?.validateInput(value);
                if (validation === null || validation === undefined) {
                    inputBox.validationMessage = undefined;
                } else {
                    inputBox.validationMessage = validation;
                }
            }
        }),
    );

    inputBox.show();

    try {
        return await deferred.promise;
    } finally {
        disposables.forEach((d) => d.dispose());
    }
}

export function showInformationMessage<T extends string>(message: string, ...items: T[]): Thenable<T | undefined>;
export function showInformationMessage<T extends MessageItem>(message: string, ...items: T[]): Thenable<T | undefined>;
export function showInformationMessage<T extends string>(
    message: string,
    options: MessageOptions,
    ...items: T[]
): Thenable<T | undefined>;
export function showInformationMessage<T extends MessageItem>(
    message: string,
    options: MessageOptions,
    ...items: T[]
): Thenable<T | undefined> {
    return window.showInformationMessage(message, options, ...items);
}

export function showErrorMessage<T extends string>(message: string, ...items: T[]): Thenable<T | undefined>;
export function showErrorMessage<T extends MessageItem>(message: string, ...items: T[]): Thenable<T | undefined>;
export function showErrorMessage<T extends string>(
    message: string,
    options: MessageOptions,
    ...items: T[]
): Thenable<T | undefined>;
export function showErrorMessage<T extends MessageItem>(
    message: string,
    options: MessageOptions,
    ...items: T[]
): Thenable<T | undefined> {
    return window.showErrorMessage(message, options, ...items);
}

export function showWarningMessage<T extends string>(message: string, ...items: T[]): Thenable<T | undefined>;
export function showWarningMessage<T extends string>(
    message: string,
    options: MessageOptions,
    ...items: T[]
): Thenable<T | undefined>;
export function showWarningMessage<T extends MessageItem>(message: string, ...items: T[]): Thenable<T | undefined>;
export function showWarningMessage<T extends MessageItem>(
    message: string,
    options: MessageOptions,
    ...items: T[]
): Thenable<T | undefined>;
export function showWarningMessage(message: string, ...items: any[]): Thenable<string | undefined> {
    return window.showWarningMessage(message, ...items);
}

export function showInputBox(options?: InputBoxOptions, token?: CancellationToken): Thenable<string | undefined> {
    return window.showInputBox(options, token);
}

export function createOutputChannel(name: string, languageId?: string): OutputChannel {
    return window.createOutputChannel(name, languageId);
}

export function createLogOutputChannel(name: string): LogOutputChannel {
    return window.createOutputChannel(name, { log: true });
}

export function registerFileDecorationProvider(provider: FileDecorationProvider): Disposable {
    return window.registerFileDecorationProvider(provider);
}

export function onDidChangeWindowState(
    listener: (e: WindowState) => any,
    thisArgs?: any,
    disposables?: Disposable[],
): Disposable {
    return window.onDidChangeWindowState(listener, thisArgs, disposables);
}
