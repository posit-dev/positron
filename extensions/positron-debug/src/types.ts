/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DebugProtocol } from '@vscode/debugprotocol';

export interface DumpCellArguments {
	code: string;
}

export interface DumpCellResponseBody {
	sourcePath: string;
}

/**
 * Represents the response body containing debugger information.
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
