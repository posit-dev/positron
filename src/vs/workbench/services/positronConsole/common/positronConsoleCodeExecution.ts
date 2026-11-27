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
	Agent = 'agent',
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
 * A well-known key in {@link IConsoleCodeAttribution.metadata}. When set to
 * `true`, the code's completeness has already been verified by the caller and
 * needs no further checking in the Console. This is the case when code is run
 * from a script via an editor statement range provider: the provider has
 * already located exactly one complete statement, so re-checking it in the
 * Console (via an input boundary provider or a runtime completeness roundtrip)
 * is redundant.
 *
 * When present and true, the Console runs the code as-is -- skipping its own
 * completeness and input-boundary checks -- exactly as it does when the
 * "prompt when incomplete" setting is disabled.
 */
export const COMPLETENESS_VERIFIED_METADATA_KEY = 'completenessVerified';

/**
 * Returns whether the given attribution marks its code as already
 * completeness-verified. See {@link COMPLETENESS_VERIFIED_METADATA_KEY}.
 *
 * @param attribution The attribution describing the source of the code.
 * @returns `true` if the code's completeness was verified by the caller.
 */
export function isCompletenessVerified(attribution: IConsoleCodeAttribution): boolean {
	return attribution.metadata?.[COMPLETENESS_VERIFIED_METADATA_KEY] === true;
}

/**
 * A well-known key in {@link IConsoleCodeAttribution.metadata}. When set to
 * `true`, a person chose to run the code, such as with a chat code block's Run
 * in Console button, even though the code came from an assistant.
 */
export const USER_INITIATED_METADATA_KEY = 'userInitiated';

/**
 * Returns whether the given attribution marks its code as run by the user.
 * See {@link USER_INITIATED_METADATA_KEY}.
 *
 * @param attribution The attribution describing the source of the code.
 * @returns `true` if a person chose to run the code.
 */
export function isUserInitiated(attribution: IConsoleCodeAttribution): boolean {
	return attribution.metadata?.[USER_INITIATED_METADATA_KEY] === true;
}

/**
 * A well-known key in {@link IConsoleCodeAttribution.metadata}: the display
 * name of the AI agent that ran the code, such as "Posit Assistant" or
 * "Claude Code".
 */
export const AGENT_NAME_METADATA_KEY = 'agentName';

/**
 * A well-known key in {@link IConsoleCodeAttribution.metadata}: a command,
 * shaped like `{ command: string; arguments?: any[] }`, that reveals where the
 * agent ran the code, such as the message in a chat conversation.
 */
export const REVEAL_COMMAND_METADATA_KEY = 'revealCommand';

/**
 * The AI agent that ran some code.
 */
export interface IAgentAttribution {
	/** The agent's display name. */
	name: string;

	/** A command that reveals where the agent ran the code, if the agent offers one. */
	revealCommand?: { command: string; arguments?: unknown[] };
}

/**
 * Gets the AI agent that ran some code.
 *
 * @param attribution The attribution describing the source of the code.
 * @returns The agent, or `undefined` if no agent ran the code.
 */
export function getAgentAttribution(attribution: IConsoleCodeAttribution): IAgentAttribution | undefined {
	if (isUserInitiated(attribution)) {
		return undefined;
	}
	const agentName = attribution.metadata?.[AGENT_NAME_METADATA_KEY];
	let name: string;
	if (typeof agentName === 'string' && agentName) {
		name = agentName;
	} else if (attribution.source === CodeAttributionSource.Agent) {
		name = localize('positron.console.externalAgent', "External agent");
	} else {
		return undefined;
	}
	const revealCommand = attribution.metadata?.[REVEAL_COMMAND_METADATA_KEY];
	const hasRevealCommand = typeof revealCommand?.command === 'string' &&
		(revealCommand.arguments === undefined || Array.isArray(revealCommand.arguments));
	return {
		name,
		revealCommand: hasRevealCommand ?
			{ command: revealCommand.command, arguments: revealCommand.arguments } :
			undefined,
	};
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
