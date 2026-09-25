/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

/** Setting that picks where error Fix/Explain actions are sent. */
export const ERROR_ACTIONS_TARGET_KEY = 'ai.errorActions.target';

/** Built-in target: Posit Assistant, via its posit-assistant.newChat command. */
export const POSIT_ASSISTANT_TARGET_ID = 'posit-assistant';

/**
 * Payload passed to a contributed target's command when the user presses Fix
 * or Explain on an error.
 */
export interface IErrorActionRequest {
	/** Which button the user pressed. */
	action: 'fix' | 'explain';
	/** Instruction for the assistant, e.g. "Fix this console error." */
	prompt: string;
	/** Plain-text error details (message, traceback, failing code), ANSI-free. */
	context: string;
	/** Display name for the context, e.g. "Console Error". */
	contextName: string;
}

/** A Fix/Explain target contributed by an extension. */
export interface IErrorActionTarget {
	/** Value of the target in the ai.errorActions.target setting. */
	id: string;
	/** Name shown in the setting's dropdown. */
	label: string;
	description?: string;
	/** Command invoked with a single {@link IErrorActionRequest} argument. */
	command: string;
	/**
	 * Extension that must be installed and enabled for the target to be
	 * offered, e.g. the assistant the contributing extension adapts.
	 */
	requiresExtension?: string;
}

export const IErrorActionTargetService = createDecorator<IErrorActionTargetService>('errorActionTargetService');

/** Tracks where error Fix/Explain actions should be sent. */
export interface IErrorActionTargetService {
	readonly _serviceBrand: undefined;

	/** Fires when the contributed targets or the configured target change. */
	readonly onDidChange: Event<void>;

	/** Contributed targets whose required extension, if any, is available. */
	readonly targets: readonly IErrorActionTarget[];

	/**
	 * The contributed target selected in the ai.errorActions.target setting.
	 * Undefined when Posit Assistant is selected, or when the selected target
	 * is not available (so callers fall back to Posit Assistant).
	 */
	getConfiguredTarget(): IErrorActionTarget | undefined;

	/**
	 * Send an error to a contributed target. Failures are logged and surfaced as
	 * a notification rather than thrown.
	 */
	run(target: IErrorActionTarget, request: IErrorActionRequest): Promise<void>;
}
