/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
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
	ExternalAgent = 'external-agent',
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
 * The provenance label the Console shows next to code an external agent
 * executed (e.g. "Claude Code"), or undefined when the execution should carry
 * no label. External agents name themselves via `metadata.displayName`;
 * executions from an agent that never identified itself get a generic label.
 */
export function externalAgentLabel(attribution: IConsoleCodeAttribution): string | undefined {
	if (attribution.source !== CodeAttributionSource.ExternalAgent) {
		return undefined;
	}
	const displayName = attribution.metadata?.displayName;
	return typeof displayName === 'string' && displayName.length > 0
		? displayName
		: localize('positron.console.externalAgentLabel', "External Agent");
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
