/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * Jupyter additions to the Debug Adapter Protocol (DAP) for debugging notebook cells and consoles.
 * Docstrings are based on the official Jupyter Client documentation.
 * Only the currently used additions are included.
 *
 * @see https://jupyter-client.readthedocs.io/en/latest/messaging.html#additions-to-the-dap
 */

import { DebugProtocol } from '@vscode/debugprotocol';

/**
 * In order to support the debugging of notebook cells and of Jupyter consoles,
 * which are not based on source files, we need a message to submit code to the
 * debugger to which breakpoints can be added.
 *
 * @see https://jupyter-client.readthedocs.io/en/latest/messaging.html#dumpcell
 */
export interface DumpCellArguments {
	/** The content of the cell being submitted. */
	code: string;
}

/**
 * The response body for the {@link DumpCellArguments dumpCell} request.
 */
export interface DumpCellResponseBody {
	/** Filename for the dumped source. */
	sourcePath: string;
}

/**
 * In order to support page reloading, or a client connecting at a later stage,
 * Jupyter kernels must store the state of the debugger (such as breakpoints,
 * whether the debugger is currently stopped).
 *
 * The debugInfo request is a DAP Request with no extra argument.
 *
 * @see https://jupyter-client.readthedocs.io/en/latest/messaging.html#debuginfo
 */
export interface DebugInfoArguments {
}

/**
 * The response body for the {@link DebugInfoArguments debugInfo} request.
 */
export interface DebugInfoResponseBody {
	/* Indicates whether the debugger is started. */
	isStarted: boolean;

	/* The hash method used for code cells. Default is 'Murmur2'. */
	hashMethod: string;

	/* The seed for hashing code cells. */
	hashSeed: number;

	/* Prefix for temporary file names. */
	tmpFilePrefix: string;

	/* Suffix for temporary file names. */
	tmpFileSuffix: string;

	/* Breakpoints currently registered in the debugger. */
	breakpoints: {
		/* Source file. */
		source: string;

		/* List of breakpoints for that source file. */
		breakpoints: DebugProtocol.Breakpoint[];
	}[];

	/* Threads in which the debugger is currently in a stopped state. */
	stoppedThreads: number[];

	/* Whether the debugger supports rich rendering of variables. */
	richRendering: boolean;

	/* Exception names used to match leaves or nodes in a tree of exception. */
	exceptionPaths: string[];
}
