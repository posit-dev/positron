/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from '../../../../base/common/event.js';
import { StringSHA1 } from '../../../../base/common/hash.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IMcpCallerContext, mcpClientDisplayName } from '../../../../platform/positronMcp/common/positronMcp.js';
import { IPositronModalDialogsService } from '../../../services/positronModalDialogs/common/positronModalDialogs.js';
import { AUDIT_LOG_DETAIL_KEY } from '../common/positronMcpConfiguration.js';

/** How long a per-code consent approval is cached before being asked again. */
const CONSENT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Gates AI-initiated code execution behind a user-consent prompt, ported from
 * the positron-mcp extension's `UserConsentManager`. The extension persisted the
 * "allow all this session" choice in the extension's workspaceState; here the
 * choice lives in memory for the life of this window's tool service, which is the
 * core-side equivalent of one MCP session's worth of consent. The prompt renders
 * in this (the pinned) window because the service runs in its renderer.
 *
 * All consent is scoped per client: "Allow All" granted to Claude Code does not
 * cover Codex, and one agent's cached per-code decision never skips another
 * agent's prompt. The scope key is the client name when the agent identified
 * itself, else its MCP session id, so anonymous sessions never pool consent.
 */
export class UserConsentManager extends Disposable {
	/**
	 * Per-(client+language+code-hash) approvals, each expiring after the
	 * timeout. Only allows are cached; a denial always re-asks.
	 */
	private readonly _consentCache = new Set<string>();

	/** The client scope keys the user has granted "allow all code execution" to. */
	private readonly _allowAll = new Set<string>();

	private readonly _onDidChangeAllowAll = this._register(new Emitter<boolean>());
	/** Fires with the new value when the allow-all decision is granted or reset. */
	readonly onDidChangeAllowAll = this._onDidChangeAllowAll.event;

	constructor(
		private readonly _modalDialogsService: IPositronModalDialogsService,
		private readonly _configurationService: IConfigurationService,
		private readonly _logService: ILogService,
	) {
		super();
	}

	/**
	 * Request consent to run `code` in `languageId` on behalf of `caller`.
	 * Returns true if the user allows it (or has allowed all execution for that
	 * client this session), false if denied.
	 */
	async requestCodeExecutionConsent(languageId: string, code: string, caller?: IMcpCallerContext): Promise<boolean> {
		const clientKey = consentScopeKey(caller);
		const cacheKey = `${clientKey}:${languageId}:${hashCode(code)}`;

		if (this._consentCache.has(cacheKey)) {
			return true;
		}

		if (this._allowAll.has(clientKey)) {
			this._cacheConsent(cacheKey);
			return true;
		}

		const agent = caller?.clientName ? mcpClientDisplayName(caller.clientName) : 'AI';

		// Log the request for transparency.
		this._logService.info(`[PositronMcp] Code execution request from ${agent}: ${languageId}, ${code.split('\n').length} lines`);

		const codeLines = code.split('\n').length;
		const codePreview = code.length > 100
			? code.substring(0, 100).replace(/\n/g, ' ') + '...'
			: code.replace(/\n/g, ' ');

		// Point at what the logs actually contain: the complete code reaches the
		// audit file only when the detail setting is 'full'; otherwise the logs
		// hold a truncated preview.
		const logsNote = this._configurationService.getValue<string>(AUDIT_LOG_DETAIL_KEY) === 'full'
			? '(Full code in the MCP audit log)'
			: '(Code preview in MCP logs)';

		// First ask whether to allow this specific execution.
		const allowExecution = await this._modalDialogsService.showSimpleModalDialogPrompt(
			`Execute ${languageId.toUpperCase()} Code?`,
			`${agent} wants to run ${codeLines} lines of code. Preview: "${codePreview}" ${logsNote}`,
			'Allow',
			'Deny',
		);

		if (!allowExecution) {
			return false;
		}

		// If allowed, ask whether to allow all for this session. Keep the button
		// labels short: the modal action bar uses a fixed 80px-wide button, so
		// longer labels wrap and clip. The "this session" scope is in the message.
		const allowAllSession = await this._modalDialogsService.showSimpleModalDialogPrompt(
			'Allow All Code Execution?',
			`Allow all code execution from ${agent} this session? (Reset via command palette)`,
			'Allow All',
			'Just Once',
		);

		if (allowAllSession && !this._allowAll.has(clientKey)) {
			const wasActive = this._allowAll.size > 0;
			this._allowAll.add(clientKey);
			if (!wasActive) {
				this._onDidChangeAllowAll.fire(true);
			}
		}

		this._cacheConsent(cacheKey);
		return true;
	}

	/** Whether "allow all code execution this session" is in effect for any client. */
	isAllowAllActive(): boolean {
		return this._allowAll.size > 0;
	}

	/** Reset all consent state, for every client (wired to the positron.mcp.resetConsent command). */
	reset(): void {
		this._consentCache.clear();
		if (this._allowAll.size > 0) {
			this._allowAll.clear();
			this._onDidChangeAllowAll.fire(false);
		}
	}

	private _cacheConsent(cacheKey: string): void {
		this._consentCache.add(cacheKey);
		setTimeout(() => this._consentCache.delete(cacheKey), CONSENT_TIMEOUT_MS);
	}
}

/**
 * The scope a consent decision applies to: the client name when the agent
 * identified itself (all of one agent's MCP sessions share consent), else the
 * MCP session id (an anonymous session's consent is its own), else a fixed
 * bucket for calls with no caller context at all.
 */
function consentScopeKey(caller: IMcpCallerContext | undefined): string {
	return caller?.clientName ?? caller?.mcpSessionId ?? 'unknown';
}

/** Stable hash of a code string, for the consent cache key. */
function hashCode(code: string): string {
	const sha1 = new StringSHA1();
	sha1.update(code);
	return sha1.digest();
}
