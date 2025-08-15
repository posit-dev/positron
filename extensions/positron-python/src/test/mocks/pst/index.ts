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

/**
 * Possible code execution modes for a language runtime
 */
export enum RuntimeCodeExecutionMode {
    /**
     * Interactive code execution:
     *          Displayed to user: Yes
     * Combined with pending code: Yes
     *          Stored in history: Yes
     */
    Interactive = 'interactive',

    /**
     * Non-interactive code execution:
     *          Displayed to user: Yes
     * Combined with pending code: No
     *          Stored in history: Yes
     */
    NonInteractive = 'non-interactive',

    /**
     * Transient code execution:
     *          Displayed to user: Yes
     * Combined with pending code: No
     *          Stored in history: No
     */
    Transient = 'transient',

    /**
     * Silent code execution:
     *          Displayed to user: No
     * Combined with pending code: No
     *          Stored in history: No
     */
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
    DebugEvent = 'debug_event',
    DebugReply = 'debug_reply',
    IPyWidget = 'ipywidget',
    UpdateOutput = 'update_output',
}

export enum LanguageRuntimeStreamName {
    Stdout = 'stdout',
    Stderr = 'stderr',
}

export enum RuntimeOnlineState {
    Idle = 'idle',
    Busy = 'busy',
    Starting = 'starting',
}

export enum RuntimeState {
    Uninitialized = 'uninitialized',
    Initializing = 'initializing',
    Starting = 'starting',
    Ready = 'ready',
    Idle = 'idle',
    Busy = 'busy',
    Restarting = 'restarting',
    Exiting = 'exiting',
    Exited = 'exited',
    Offline = 'offline',
    Interrupting = 'interrupting',
}
