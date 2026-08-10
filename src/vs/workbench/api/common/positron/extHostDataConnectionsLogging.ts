/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as positron from 'positron';
import type * as vscode from 'vscode';
import { localize } from '../../../../nls.js';

/**
 * The channel surface the lazy logger needs. `vscode.LogOutputChannel` satisfies it
 * structurally. Kept narrow so a test can supply a fake without an extension host.
 *
 * The five log methods are spelled out here rather than inherited from
 * `positron.DataConnectionLogger`. Vitest files are excluded from `src/tsconfig.json` and no
 * `tsconfig.json` includes them, so the editor type-checks them in an inferred project that
 * cannot resolve the ambient `positron` module. Inheriting would leave this interface with
 * only `dispose()` there, and every test that builds a fake channel would report spurious
 * errors.
 *
 * The two cannot drift apart silently: `createLazyDriverLogger` returns
 * `positron.DataConnectionLogger`, and it builds that object out of these methods, so adding a
 * method to the public interface fails to compile here until this one gains it too.
 */
export interface IDriverLogChannel {
	trace(message: string): void;
	debug(message: string): void;
	info(message: string): void;
	warn(message: string): void;
	error(message: string): void;
	dispose(): void;
}

/**
 * Reduces a message to its first non-empty line.
 *
 * Driver errors can echo the failing SQL statement after their first line, and the Data Explorer
 * inlines the user's filter and search values into that SQL rather than binding them as
 * parameters, so taking only the first line drops that trailing echo in the common case. This is
 * partial mitigation, not a guarantee: an engine can still inline a value into the primary
 * message itself (verified for DuckDB, whose "Conversion Error" message embeds the offending
 * value directly), and truncation does nothing to stop that. A `LogOutputChannel` renders one
 * timestamped entry per call anyway, so multi-line messages already displayed poorly.
 *
 * Lines are split on `\r?\n` so CRLF-separated messages behave the same as LF ones. A message
 * that starts with a blank line (a leading newline, or captured stderr that begins with one)
 * would otherwise reduce to an empty string and log a blank entry while discarding the real
 * diagnostic, so this returns the first line that is not empty once trimmed. If every line is
 * empty, the result is the empty string.
 */
function firstLine(message: string): string {
	const lines = message.split(/\r?\n/);
	const nonEmptyLine = lines.find(line => line.trim().length > 0);
	return (nonEmptyLine ?? '').trim();
}

/**
 * Builds a data connection driver logger whose output channel is created on first use.
 *
 * `info`, `warn`, and `error` create the channel. `trace` and `debug` write only if it
 * already exists: the channel filters by level internally, so a trace call at the default
 * Info level would otherwise create an entry in the Output panel that then renders empty.
 *
 * @param driverName The driver's display name. The channel name gets the shared prefix.
 * @param createChannel Builds the underlying channel. Called at most once.
 */
export function createLazyDriverLogger(
	driverName: string,
	createChannel: (name: string) => IDriverLogChannel
): positron.DataConnectionLogger & vscode.Disposable {
	let channel: IDriverLogChannel | undefined;
	// Every driver pushes its logger into `context.subscriptions` before its RPC handler, and
	// VS Code disposes subscriptions in push order, so on deactivation the logger is disposed
	// before the handler. In-flight work started through the handler (a pending column-profile
	// promise, a rejected connect still unwinding) can still call a log method afterwards. Without
	// this flag that would recreate the channel via `ensureChannel()` and register it for an
	// extension that is already gone, with nothing left to dispose it. Once disposed, every method
	// is a permanent no-op.
	let disposed = false;

	const ensureChannel = (): IDriverLogChannel | undefined => {
		if (disposed) {
			return undefined;
		}
		if (!channel) {
			channel = createChannel(localize(
				'positron.dataConnections.driverLogChannel',
				"Data Connections: {0}",
				driverName));
		}
		return channel;
	};

	return {
		trace: message => channel?.trace(firstLine(message)),
		debug: message => channel?.debug(firstLine(message)),
		info: message => ensureChannel()?.info(firstLine(message)),
		warn: message => ensureChannel()?.warn(firstLine(message)),
		error: message => ensureChannel()?.error(firstLine(message)),
		dispose: () => {
			if (disposed) {
				return;
			}
			disposed = true;
			channel?.dispose();
			channel = undefined;
		},
	};
}
