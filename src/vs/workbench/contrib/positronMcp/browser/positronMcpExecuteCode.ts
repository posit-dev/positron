/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { DeferredPromise } from '../../../../base/common/async.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import {
	ILanguageRuntimeMessage,
	RuntimeCodeExecutionMode,
	RuntimeErrorBehavior,
	RuntimeOnlineState,
} from '../../../services/languageRuntime/common/languageRuntimeService.js';
import { IMcpCallerContext, mcpClientDisplayName } from '../../../../platform/positronMcp/common/positronMcp.js';
import { IPositronConsoleService } from '../../../services/positronConsole/browser/interfaces/positronConsoleService.js';
import { CodeAttributionSource, IConsoleCodeAttribution } from '../../../services/positronConsole/common/positronConsoleCodeExecution.js';
import { ILanguageRuntimeSession, IRuntimeSessionService } from '../../../services/runtimeSession/common/runtimeSessionService.js';

/**
 * The outcome of an MCP execute-code request. Mirrors the three terminal states
 * the positron-mcp extension's observer produced: it ran to completion, it
 * failed with a runtime error, or it outlived the timeout (the session is busy).
 */
export type ExecuteCodeOutcome =
	| { kind: 'success'; data: Record<string, unknown> }
	| { kind: 'error'; error: { name: string; message: string; traceback: string[] } }
	| { kind: 'timeout'; started: boolean; streamed: string };

/**
 * Run `code` in the active (or a freshly started) console session and observe its
 * runtime messages until it completes, fails, or the timeout elapses.
 *
 * This is the in-core replacement for the extension's `executeCode` + execution
 * observer. The extension host kept a single observer map keyed by an execution
 * id and matched every runtime message's `parent_id` against it; here we hold the
 * same contract by subscribing to each session's per-type message events and
 * filtering on our generated `executionId` (which the console service threads
 * through as the messages' `parent_id`).
 *
 * Subscriptions are attached to every current session and to any session that
 * starts while we wait, so the result is captured even when the call has to start
 * a new runtime (the console service starts one when none matches the language).
 *
 * On timeout we abandon the attempt without interrupting the session: the code
 * may be a legitimately long computation the user wants to keep, and the tool's
 * timeout message tells the model to wait or call session-interrupt explicitly.
 */
export async function executeCodeWithObserver(
	consoleService: IPositronConsoleService,
	sessionService: IRuntimeSessionService,
	languageId: string,
	code: string,
	timeoutMs: number,
	caller?: IMcpCallerContext,
): Promise<ExecuteCodeOutcome> {
	const executionId = generateUuid();
	const store = new DisposableStore();

	type Settled =
		| { kind: 'completed'; data: Record<string, unknown> }
		| { kind: 'failed'; error: { name: string; message: string; traceback: string[] } };
	const settled = new DeferredPromise<Settled>();
	let started = false;
	let streamed = '';

	const matches = (message: ILanguageRuntimeMessage) => message.parent_id === executionId;

	const watch = (session: ILanguageRuntimeSession) => {
		store.add(session.onDidReceiveRuntimeMessageStream(message => {
			if (matches(message)) {
				streamed += message.text;
			}
		}));
		store.add(session.onDidReceiveRuntimeMessageOutput(message => {
			if (matches(message)) {
				const text = message.data['text/plain'];
				if (typeof text === 'string') {
					streamed += text;
				}
			}
		}));
		store.add(session.onDidReceiveRuntimeMessageResult(message => {
			if (matches(message) && !settled.isSettled) {
				settled.complete({ kind: 'completed', data: message.data });
			}
		}));
		store.add(session.onDidReceiveRuntimeMessageError(message => {
			if (matches(message) && !settled.isSettled) {
				settled.complete({ kind: 'failed', error: { name: message.name, message: message.message, traceback: message.traceback ?? [] } });
			}
		}));
		store.add(session.onDidReceiveRuntimeMessageState(message => {
			if (!matches(message)) {
				return;
			}
			// Busy means execution has started; idle means it finished. A Result
			// message usually settles us first; the idle transition is the
			// fallback for code that produces no result value.
			if (message.state === RuntimeOnlineState.Busy) {
				started = true;
			} else if (message.state === RuntimeOnlineState.Idle && !settled.isSettled) {
				settled.complete({ kind: 'completed', data: {} });
			}
		}));
	};

	// Subscribe before dispatching so no early message is missed, and cover both
	// the existing sessions and any session the dispatch starts.
	for (const active of sessionService.getActiveSessions()) {
		watch(active.session);
	}
	store.add(sessionService.onWillStartSession(event => watch(event.session)));

	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		// Attribute the execution to the external agent that asked for it, so
		// consumers (and the console's provenance label) can tell it apart from
		// Posit Assistant. `displayName` is the console-facing name; resumed
		// sessions that never re-identified themselves have no client name and
		// fall back to the console's generic external-agent label.
		const attribution: IConsoleCodeAttribution = {
			source: CodeAttributionSource.ExternalAgent,
			metadata: {
				source: 'positron-mcp',
				clientName: caller?.clientName,
				clientVersion: caller?.clientVersion,
				displayName: caller?.clientName ? mcpClientDisplayName(caller.clientName) : undefined,
				// The context observer reads this to attribute the execution to
				// its MCP session, so alerts never echo a client's own runs back
				// at it and other clients never see them.
				mcpSessionId: caller?.mcpSessionId,
			},
		};

		// allowIncomplete=true: we submit whole blocks, not REPL lines, so bypass
		// the console's interactive completeness check. Without it, a block ending
		// on an indented line is stashed as pending input and never runs, hanging
		// until the timeout; with it, genuinely incomplete code returns as a normal
		// syntax error the model can fix. executeCode resolves once the code is
		// dispatched (returning the session id, which we don't need -- messages are
		// matched by executionId); awaiting it surfaces dispatch-time errors.
		await consoleService.executeCode(
			languageId,
			undefined,
			code,
			attribution,
			false,
			true,
			RuntimeCodeExecutionMode.Interactive,
			RuntimeErrorBehavior.Stop,
			executionId,
		);

		const TIMED_OUT = Symbol('timed-out');
		const timeout = new Promise<typeof TIMED_OUT>(resolve => {
			timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
		});

		const result = await Promise.race([settled.p, timeout]);
		if (result === TIMED_OUT) {
			return { kind: 'timeout', started, streamed };
		}
		if (result.kind === 'failed') {
			return { kind: 'error', error: result.error };
		}
		return { kind: 'success', data: result.data };
	} catch (error) {
		// executeCode rejected before dispatch (e.g. no runtime is registered for
		// the language). Surface it as a runtime error, matching the extension.
		return {
			kind: 'error',
			error: {
				name: error instanceof Error ? error.name : 'Error',
				message: error instanceof Error ? error.message : String(error),
				traceback: error instanceof Error && error.stack ? [error.stack] : [],
			},
		};
	} finally {
		if (timer) {
			clearTimeout(timer);
		}
		store.dispose();
	}
}
