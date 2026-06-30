/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { StringSHA1 } from '../../../../base/common/hash.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IPositronModalDialogsService } from '../../../services/positronModalDialogs/common/positronModalDialogs.js';

/** How long a per-code consent decision is cached before being asked again. */
const CONSENT_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Gates AI-initiated code execution behind a user-consent prompt, ported from
 * the positron-mcp extension's `UserConsentManager`. The extension persisted the
 * "allow all this session" choice in the extension's workspaceState; here the
 * choice lives in memory for the life of this window's tool service, which is the
 * core-side equivalent of one MCP session's worth of consent. The prompt renders
 * in this (the pinned) window because the service runs in its renderer.
 */
export class UserConsentManager {
	/** Per-(language+code-hash) decisions, each expiring after the timeout. */
	private readonly _consentCache = new Map<string, boolean>();

	/** Whether the user has allowed all code execution for this session. */
	private _allowAll = false;

	constructor(
		private readonly _modalDialogsService: IPositronModalDialogsService,
		private readonly _logService: ILogService,
	) { }

	/**
	 * Request consent to run `code` in `languageId`. Returns true if the user
	 * allows it (or has allowed all execution this session), false if denied.
	 */
	async requestCodeExecutionConsent(languageId: string, code: string): Promise<boolean> {
		const cacheKey = `${languageId}:${hashCode(code)}`;

		const cached = this._consentCache.get(cacheKey);
		if (cached !== undefined) {
			return cached;
		}

		if (this._allowAll) {
			this._cacheConsent(cacheKey, true);
			return true;
		}

		// Log the request for transparency.
		this._logService.info(`[PositronMcp] Code execution request: ${languageId}, ${code.split('\n').length} lines`);

		const codeLines = code.split('\n').length;
		const codePreview = code.length > 100
			? code.substring(0, 100).replace(/\n/g, ' ') + '...'
			: code.replace(/\n/g, ' ');

		// First ask whether to allow this specific execution.
		const allowExecution = await this._modalDialogsService.showSimpleModalDialogPrompt(
			`Execute ${languageId.toUpperCase()} Code?`,
			`AI wants to run ${codeLines} lines of code. Preview: "${codePreview}" (Full code in MCP logs)`,
			'Allow',
			'Deny',
		);

		if (!allowExecution) {
			return false;
		}

		// If allowed, ask whether to allow all for this session.
		const allowAllSession = await this._modalDialogsService.showSimpleModalDialogPrompt(
			'Allow All Code Execution?',
			'Allow all AI code execution this session? (Reset via command palette)',
			'Allow All (This Session)',
			'Just This Once',
		);

		if (allowAllSession) {
			this._allowAll = true;
		}

		this._cacheConsent(cacheKey, true);
		return true;
	}

	/** Reset all consent state (wired to the "reset consent" command in Phase 5). */
	reset(): void {
		this._consentCache.clear();
		this._allowAll = false;
	}

	private _cacheConsent(cacheKey: string, value: boolean): void {
		this._consentCache.set(cacheKey, value);
		setTimeout(() => this._consentCache.delete(cacheKey), CONSENT_TIMEOUT_MS);
	}
}

/** Stable hash of a code string, for the consent cache key. */
function hashCode(code: string): string {
	const sha1 = new StringSHA1();
	sha1.update(code);
	return sha1.digest();
}
