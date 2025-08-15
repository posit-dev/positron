/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { RuntimeCodeExecutionMode, RuntimeErrorBehavior } from '../../languageRuntime/common/languageRuntimeService.js';

/**
 * Code attribution sources for code executed in the Console.
 *
 * These are duplicated in the Positron API (`positron.d.ts`) and should be kept
 * in sync.
 */
export const enum CodeAttributionSource {
	Assistant = 'assistant',
	Extension = 'extension',
	Interactive = 'interactive',
	Notebook = 'notebook',
	Paste = 'paste',
	Script = 'script',
}

/**
 * A record containing metadata about the code attribution.
 */
export interface IConsoleCodeAttribution {
	/** The source of the code to be executed */
	source: CodeAttributionSource;

	/** An optional dictionary of addition source-specific metadata*/
	metadata?: Record<string, any>;
}

/**
 * Represents a code fragment and its execution options sent to a language runtime.
 */
export interface ILanguageRuntimeCodeExecutedEvent {
	/** The ID of the code execution */
	executionId: string;

	/** The session that executed the code */
	sessionId: string;

	/** The language ID of the code fragment */
	languageId: string;

	/** The code that was executed in the language runtime session */
	code: string;

	/** The attribution object that describes the source of the code */
	attribution: IConsoleCodeAttribution;

	/** The runtime that executed the code. */
	runtimeName: string;

	/** The mode used to execute the code in the language runtime session */
	mode: RuntimeCodeExecutionMode;

	/** The error disposition used to execute the code in the language runtime session */
	errorBehavior: RuntimeErrorBehavior;
}
