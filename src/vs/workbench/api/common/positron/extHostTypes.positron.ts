/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Posit, PBC.
 *--------------------------------------------------------------------------------------------*/

/**
 * The set of possible statuses for a language runtime
 */
export enum RuntimeState {
	/** The runtime has not been started or initialized yet. */
	Uninitialized = 'uninitialized',

	/** The runtime is initializing (preparing to start). */
	Initializing = 'initializing',

	/** The runtime is in the process of starting up. It isn't ready for messages. */
	Starting = 'starting',

	/** The runtime has a heartbeat and is ready for messages. */
	Ready = 'ready',

	/** The runtime is ready to execute code. */
	Idle = 'idle',

	/** The runtime is busy executing code. */
	Busy = 'busy',

	/** The runtime is in the process of shutting down. */
	Exiting = 'exiting',

	/** The runtime's host process has ended. */
	Exited = 'exited',

	/** The runtime is not responding to heartbeats and is presumed offline. */
	Offline = 'offline',

	/** The user has interrupted a busy runtime, but the runtime is not idle yet. */
	Interrupting = 'interrupting',
}


/** Possible states for the language runtime while online */
export enum RuntimeOnlineState {
	/** The runtime is starting up */
	Starting = 'starting',

	/** The runtime is currently processing an instruction or code fragment */
	Busy = 'busy',

	/** The runtime is idle */
	Idle = 'idle',
}

/** The set of possible language runtime messages */
export enum LanguageRuntimeMessageType {
	/** A message representing output (text, plots, etc.) */
	Output = 'output',

	/** A message representing echoed user input */
	Input = 'input',

	/** A message representing an error that occurred while executing user code */
	Error = 'error',

	/** A message representing a change in the runtime's online state */
	State = 'state',
}

/**
 * Possible code execution modes for a language runtime
 */
export enum RuntimeCodeExecutionMode {
	/** The code was entered interactively, and should be executed and stored in the runtime's history. */
	Interactive = 'interactive',

	/** The code should be executed but not stored in history. */
	Transient = 'transient',

	/** The code execution should be fully silent, neither displayed to the user nor stored in history. */
	Silent = 'silent'
}

/**
 * Possible error dispositions for a language runtime
 */
export enum RuntimeErrorBehavior {
	/** The runtime should stop when an error is encountered. */
	Stop = 'stop',

	/** The runtime should continue execution when an error is encountered */
	Continue = 'continue',
}
