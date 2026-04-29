/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as positron from 'positron';
import * as vscode from 'vscode';
import { DebugProtocol } from '@vscode/debugprotocol';
import { DumpCellArguments, DebugInfoResponseBody } from './jupyterDebugProtocol.js';
import { PathEncoder } from './pathEncoder.js';
import { Disposable } from './util.js';
import { getNotebookSession } from './notebookDebugService.js';
import { log } from './extension.js';

// Placeholder value for the `seq` field of DAP requests. Sequencing is
// handled by the Jupyter transport layer, not DAP.
const PLACEHOLDER_SEQ = 0;

// Tag reported by kernels that support proactive breakpoint syncing (i.e.
// breakpoints sent outside of debug sessions). Currently only Ark reports this
// so breakpoints can be injected at parse time during normal cell execution
// outside of debug sessions.
const PROACTIVE_BREAKPOINTS_FEATURE = 'proactive breakpoints';

/**
 * Keeps the kernel's breakpoint table in sync with the editor's breakpoints
 * at all times, not only during debug sessions. Communicates with the kernel
 * via the Control channel's debug request/reply protocol.
 *
 * Used with Ark to allow injection of breakpoints at parse-time while code is
 * executed outside of debugging sessions. Without this, users would need to
 * first start a debugging session, then re-execute all code/cells containing
 * breakpoints.
 */
export class BreakpointSyncService extends Disposable {
	/** PathEncoder per runtime session ID. */
	private readonly _encoderBySession = new Map<string, PathEncoder>();

	/** Tracks whether we've initialized (sent debugInfo) for a given runtime session. */
	private readonly _initializedSessions = new Set<string>();

	/** Tracks source URIs that have been synced to the kernel, per session ID. */
	private readonly _syncedSourcesBySession = new Map<string, Set<string>>();

	/** Pending sync promise per notebook URI, used to serialize overlapping syncs. */
	private readonly _pendingSync = new Map<string, Promise<void>>();

	constructor() {
		super();

		this._register(vscode.debug.onDidChangeBreakpoints((event) => {
			this.onBreakpointsChanged(event);
		}));
	}

	private onBreakpointsChanged(event: vscode.BreakpointsChangeEvent): void {
		const changedUris = new Set<string>();

		// Collect URIs where breakpoints have changed. The handler reads the whole
		// breakpoint state later on so we do not need to track deltas here.
		for (const bp of [...event.added, ...event.changed, ...event.removed]) {
			if (bp instanceof vscode.SourceBreakpoint) {
				changedUris.add(bp.location.uri.toString());
			}
		}

		for (const uriStr of changedUris) {
			const uri = vscode.Uri.parse(uriStr, true);
			switch (uri.scheme) {
				case 'vscode-notebook-cell': {
					const notebookUri = uri.with({ scheme: 'file', fragment: '' });
					this.enqueueSync(notebookUri);
					break;
				}
				// TODO: Handle `file:` scheme for console sessions (for Ark)
			}
		}
	}

	// --- Notebook-specific sync -------------------------------------------------

	/**
	 * Enqueue a sync for a notebook, chaining onto any in-flight sync so
	 * overlapping breakpoint events don't race.
	 */
	private enqueueSync(notebookUri: vscode.Uri): void {
		const key = notebookUri.toString();
		const previous = this._pendingSync.get(key) ?? Promise.resolve();
		const next = previous.then(() =>
			this.syncNotebookBreakpoints(notebookUri).catch((error) => {
				log.error(`[breakpoint-sync] Failed to sync breakpoints for ${key}:`, error);
			})
		).then(() => {
			// Clean up once the chain settles, but only if we're still the
			// latest entry (a newer sync may have chained on in the meantime).
			if (this._pendingSync.get(key) === next) {
				this._pendingSync.delete(key);
			}
		});
		this._pendingSync.set(key, next);
	}

	private async syncNotebookBreakpoints(notebookUri: vscode.Uri): Promise<void> {
		// During an active debug session the RuntimeDebugAdapter handles
		// `setBreakpoints`. Sending them here as well would collide. For Ark in
		// console mode, we'll probably want a single source of truth with BP sync
		// via Jupyter.
		if (this.hasActiveDebugSession(notebookUri)) {
			return;
		}

		const notebook = vscode.workspace.notebookDocuments.find(
			(doc) => doc.uri.toString() === notebookUri.toString()
		);
		if (!notebook) {
			return;
		}

		const runtimeSession = await getNotebookSession(notebookUri);
		if (!runtimeSession) {
			return;
		}

		// Only sync breakpoints to kernels that support proactive
		// breakpoint syncing (parse-time breakpoint injection).
		const features = runtimeSession.runtimeInfo?.supported_features ?? [];
		if (!features.includes(PROACTIVE_BREAKPOINTS_FEATURE)) {
			return;
		}
		const sessionId = runtimeSession.metadata.sessionId;

		const encoder = await this.ensureNotebookEncoder(runtimeSession);
		if (!encoder) {
			return;
		}

		const allBreakpoints = vscode.debug.breakpoints;
		const breakpointsByCell = new Map<string, vscode.SourceBreakpoint[]>();

		// Collect all breakpoints for this notebook, grouped by cell. Cell identity
		// is determined by the breakpoint's Source URI (each cell is a separate
		// source in notebook context).
		for (const bp of allBreakpoints) {
			if (!(bp instanceof vscode.SourceBreakpoint) || !bp.enabled) {
				continue;
			}
			const bpUri = bp.location.uri;
			if (bpUri.scheme !== 'vscode-notebook-cell') {
				continue;
			}

			// Extract the notebook URI from the cell URI by stripping the
			// scheme and fragment (which encodes the cell identity).
			// Skip breakpoints that belong to a different notebook.
			const bpNotebookUri = bpUri.with({ scheme: 'file', fragment: '' });
			if (bpNotebookUri.toString() !== notebookUri.toString()) {
				continue;
			}

			const key = bpUri.toString();
			if (!breakpointsByCell.has(key)) {
				breakpointsByCell.set(key, []);
			}
			breakpointsByCell.get(key)!.push(bp);
		}

		// For each cell with breakpoints, dump and set.
		for (const [cellUriStr, breakpoints] of breakpointsByCell) {
			const cellUri = vscode.Uri.parse(cellUriStr, true);
			const cell = notebook.getCells().find(
				(c) => c.document.uri.toString() === cellUri.toString()
			);
			if (!cell) {
				continue;
			}

			try {
				const code = cell.document.getText();
				const sourcePath = encoder.encode(code);

				// Notebook cells don't exist as files on disk. The Jupyter Debug
				// Protocol's `dumpCell` writes the cell source to a content-addressed
				// temp file so `setBreakpoints` can reference it. This mirrors what
				// `RuntimeDebugAdapter` does during active debug sessions.
				await this.dumpCell(runtimeSession, code);

				const dapBreakpoints: DebugProtocol.SourceBreakpoint[] = breakpoints.map((bp) => ({
					line: bp.location.range.start.line + 1, // DAP is 1-based
					condition: bp.condition,
					hitCondition: bp.hitCondition,
					logMessage: bp.logMessage,
				}));

				await this.setBreakpoints(runtimeSession, sourcePath, dapBreakpoints);
				this.getSyncedSources(sessionId).add(cellUriStr);
			} catch (error) {
				log.warn(`[breakpoint-sync] Failed to sync breakpoints for cell ${cellUriStr}:`, error);
			}
		}

		// Clear breakpoints for sources that were previously synced but no longer
		// have breakpoints
		const syncedSources = this.getSyncedSources(sessionId);
		for (const sourceUriStr of Array.from(syncedSources)) {
			if (breakpointsByCell.has(sourceUriStr)) {
				continue;
			}
			const sourceUri = vscode.Uri.parse(sourceUriStr, true);
			if (sourceUri.scheme !== 'vscode-notebook-cell') {
				continue;
			}
			const bpNotebookUri = sourceUri.with({ scheme: 'file', fragment: '' });
			if (bpNotebookUri.toString() !== notebookUri.toString()) {
				continue;
			}
			const cell = notebook.getCells().find(
				(c) => c.document.uri.toString() === sourceUri.toString()
			);
			if (!cell) {
				syncedSources.delete(sourceUriStr);
				continue;
			}
			try {
				const code = cell.document.getText();
				const sourcePath = encoder.encode(code);
				await this.setBreakpoints(runtimeSession, sourcePath, []);
			} catch (error) {
				log.warn(`[breakpoint-sync] Failed to clear breakpoints for ${sourceUriStr}:`, error);
			}
			syncedSources.delete(sourceUriStr);
		}
	}

	// Initialize a `PathEncoder` from the kernel's `debugInfo` (hash method,
	// seed, temp file prefix/suffix). Cached for the lifetime of the session.
	private async ensureNotebookEncoder(
		runtimeSession: positron.LanguageRuntimeSession,
	): Promise<PathEncoder | undefined> {
		const sessionId = runtimeSession.metadata.sessionId;

		if (this._encoderBySession.has(sessionId) && this._initializedSessions.has(sessionId)) {
			return this._encoderBySession.get(sessionId)!;
		}

		try {
			const debugInfo = await this.debugInfo(runtimeSession);
			const encoder = new PathEncoder();
			encoder.setOptions({
				hashMethod: debugInfo.hashMethod,
				hashSeed: debugInfo.hashSeed,
				tmpFilePrefix: debugInfo.tmpFilePrefix,
				tmpFileSuffix: debugInfo.tmpFileSuffix,
			});
			this._encoderBySession.set(sessionId, encoder);
			this._initializedSessions.add(sessionId);

			// Clean up cached state when the session ends.
			this._register(runtimeSession.onDidEndSession(() => {
				this._encoderBySession.delete(sessionId);
				this._initializedSessions.delete(sessionId);
				this._syncedSourcesBySession.delete(sessionId);
			}));

			return encoder;
		} catch (error) {
			log.warn(`[breakpoint-sync] Failed to get debugInfo for session ${sessionId}:`, error);
			return undefined;
		}
	}

	private getSyncedSources(sessionId: string): Set<string> {
		let set = this._syncedSourcesBySession.get(sessionId);
		if (!set) {
			set = new Set();
			this._syncedSourcesBySession.set(sessionId, set);
		}
		return set;
	}

	private hasActiveDebugSession(notebookUri: vscode.Uri): boolean {
		const uriStr = notebookUri.toString();
		return vscode.debug.activeDebugSession?.type === 'notebook' &&
			vscode.debug.activeDebugSession.configuration.__notebookUri === uriStr;
	}

	// --- Debug channel helpers --------------------------------------------------

	// These send DAP requests to the kernel via `runtimeSession.debug()`, which
	// wraps them as `debug_request` messages on the Jupyter control channel.

	private async sendDebugRequest(
		runtimeSession: positron.LanguageRuntimeSession,
		command: string,
		args: object,
	): Promise<DebugProtocol.Response> {
		const request: DebugProtocol.Request = {
			type: 'request',
			seq: PLACEHOLDER_SEQ,
			command,
			arguments: args,
		};
		const response = await runtimeSession.debug(request) as unknown as DebugProtocol.Response;
		if (response.success === false) {
			throw new Error(`Debug request '${command}' failed: ${response.message ?? 'unknown error'}`);
		}
		return response;
	}

	private async debugInfo(runtimeSession: positron.LanguageRuntimeSession): Promise<DebugInfoResponseBody> {
		const response = await this.sendDebugRequest(runtimeSession, 'debugInfo', {});
		return response.body as DebugInfoResponseBody;
	}

	private async setBreakpoints(
		runtimeSession: positron.LanguageRuntimeSession,
		sourcePath: string,
		breakpoints: DebugProtocol.SourceBreakpoint[]
	): Promise<void> {
		await this.sendDebugRequest(runtimeSession, 'setBreakpoints', {
			source: { path: sourcePath },
			breakpoints,
			sourceModified: false,
		} satisfies DebugProtocol.SetBreakpointsArguments);
	}

	private async dumpCell(runtimeSession: positron.LanguageRuntimeSession, code: string): Promise<void> {
		await this.sendDebugRequest(runtimeSession, 'dumpCell', { code } satisfies DumpCellArguments);
	}
}
