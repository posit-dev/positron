/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2024-2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

// Types copied from positron.d.ts for use in the positron-python unit test environment.

export enum LanguageRuntimeSessionMode {
    Console = 'console',
    Notebook = 'notebook',
    Background = 'background',
}

export enum RuntimeCodeExecutionMode {
    Interactive = 'interactive',
    Transient = 'transient',
    Silent = 'silent',
}

export enum RuntimeErrorBehavior {
    Stop = 'stop',
    Continue = 'continue',
}

export enum LanguageRuntimeMessageType {
    ClearOutput = 'clear_output',
    Output = 'output',
    Result = 'result',
    Stream = 'stream',
    Input = 'input',
    Error = 'error',
    Prompt = 'prompt',
    State = 'state',
    Event = 'event',
    CommOpen = 'comm_open',
    CommData = 'comm_data',
    CommClosed = 'comm_closed',
    IPyWidget = 'ipywidget',
}

export enum LanguageRuntimeStreamName {
    Stdout = 'stdout',
    Stderr = 'stderr',
}

export enum RuntimeOnlineState {
    Idle = 'idle',
    Busy = 'busy',
}
