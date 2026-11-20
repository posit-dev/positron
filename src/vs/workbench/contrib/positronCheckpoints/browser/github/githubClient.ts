/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { asJson, asText, IRequestService } from '../../../../../platform/request/common/request.js';
import { IAuthenticationService } from '../../../../services/authentication/common/authentication.js';

const API_ROOT = 'https://api.github.com';
const AUTH_PROVIDER_ID = 'github';
const AUTH_SCOPES = ['repo'];
const MAX_DETAIL_LENGTH = 300;

export type CreateRepositoryFailure = 'sign-in-required' | 'name-taken' | 'not-allowed' | 'offline' | 'unknown';
export type InviteFailure = 'no-such-user' | 'not-allowed' | 'sign-in-required' | 'unknown';

export type CreateRepositoryResult =
	| { ok: true; cloneUrl: string; htmlUrl: string }
	| { ok: false; reason: CreateRepositoryFailure; detail: string };

export type InviteResult =
	| { ok: true }
	| { ok: false; reason: InviteFailure; detail: string };

export interface ProjectLink {
	owner: string;
	name: string;
	cloneUrl: string;
}

/**
 * The GitHub calls that sharing a project needs. Every call is made after a click.
 */
export interface IGitHubClient {
	createRepository(name: string, isPrivate: boolean, owner?: string): Promise<CreateRepositoryResult>;
	invite(owner: string, name: string, login: string): Promise<InviteResult>;
	parseProjectLink(text: string): ProjectLink | undefined;
}

export const EMAIL_NOT_ACCEPTED_DETAIL = 'Enter the person\'s GitHub user name.';

const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9]))*$/;
const MAX_OWNER_LENGTH = 39;
const NAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const MAX_NAME_LENGTH = 100;

const LINK_PATTERNS: RegExp[] = [
	/^https?:\/\/(?:www\.)?github\.com\/(?<owner>[^/\s]+)\/(?<name>[^/\s]+?)\/?$/i,
	/^git@github\.com:(?<owner>[^/\s]+)\/(?<name>[^/\s]+)$/i,
	/^(?<owner>[^/\s:@.]+)\/(?<name>[^/\s:@]+)$/,
];

function isValidOwner(owner: string): boolean {
	return owner.length <= MAX_OWNER_LENGTH && OWNER_PATTERN.test(owner);
}

function isValidName(name: string): boolean {
	return name.length <= MAX_NAME_LENGTH && name !== '.' && name !== '..' && NAME_PATTERN.test(name);
}

/**
 * Reads a project link in any of the forms people copy: a web link, a link ending in `.git`, an
 * ssh-style link, or `owner/name`. Returns undefined when the text is none of these or when the
 * owner or name uses characters GitHub does not allow.
 */
export function parseProjectLink(text: string): ProjectLink | undefined {
	const trimmed = text.trim();
	for (const pattern of LINK_PATTERNS) {
		const groups = pattern.exec(trimmed)?.groups;
		if (!groups) {
			continue;
		}
		const owner = groups.owner;
		const name = groups.name.replace(/\.git$/i, '');
		if (isValidOwner(owner) && isValidName(name)) {
			return { owner, name, cloneUrl: `https://github.com/${owner}/${name}.git` };
		}
		return undefined;
	}
	return undefined;
}

interface GitHubErrorBody {
	message?: string;
	errors?: { message?: string; code?: string }[];
}

interface CreatedRepository {
	clone_url: string;
	html_url: string;
}

/**
 * Calls the GitHub REST API with the person's existing GitHub sign-in. It never starts a
 * sign-in itself, and it never writes the token to a log.
 */
export class GitHubClient implements IGitHubClient {
	constructor(
		private readonly _authenticationService: IAuthenticationService,
		private readonly _requestService: IRequestService,
		private readonly _logService: ILogService,
	) { }

	parseProjectLink(text: string): ProjectLink | undefined {
		return parseProjectLink(text);
	}

	async createRepository(name: string, isPrivate: boolean, owner?: string): Promise<CreateRepositoryResult> {
		const token = await this._getToken();
		if (token === undefined) {
			return { ok: false, reason: 'sign-in-required', detail: 'No GitHub sign-in.' };
		}
		const path = owner ? `/orgs/${encodeURIComponent(owner)}/repos` : '/user/repos';
		const response = await this._send('POST', path, token, { name, private: isPrivate });
		if (response.kind === 'network-error') {
			return { ok: false, reason: 'offline', detail: response.detail };
		}
		switch (response.status) {
			case 201:
			case 200: {
				const created = response.json as Partial<CreatedRepository> | undefined;
				if (typeof created?.clone_url === 'string' && typeof created.html_url === 'string') {
					return { ok: true, cloneUrl: created.clone_url, htmlUrl: created.html_url };
				}
				return { ok: false, reason: 'unknown', detail: 'GitHub did not return the new project links.' };
			}
			case 401:
				return { ok: false, reason: 'sign-in-required', detail: response.detail };
			case 403:
				return { ok: false, reason: 'not-allowed', detail: response.detail };
			case 422:
				if (/name already exists/i.test(response.text)) {
					return { ok: false, reason: 'name-taken', detail: response.detail };
				}
				return { ok: false, reason: 'unknown', detail: response.detail };
			default:
				return { ok: false, reason: 'unknown', detail: response.detail };
		}
	}

	async invite(owner: string, name: string, login: string): Promise<InviteResult> {
		if (login.includes('@')) {
			return { ok: false, reason: 'no-such-user', detail: EMAIL_NOT_ACCEPTED_DETAIL };
		}
		const token = await this._getToken();
		if (token === undefined) {
			return { ok: false, reason: 'sign-in-required', detail: 'No GitHub sign-in.' };
		}
		const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/collaborators/${encodeURIComponent(login)}`;
		const response = await this._send('PUT', path, token, { permission: 'push' });
		if (response.kind === 'network-error') {
			return { ok: false, reason: 'unknown', detail: response.detail };
		}
		switch (response.status) {
			case 201:
			case 204:
				return { ok: true };
			case 401:
				return { ok: false, reason: 'sign-in-required', detail: response.detail };
			case 403:
				return { ok: false, reason: 'not-allowed', detail: response.detail };
			case 404:
				return { ok: false, reason: 'no-such-user', detail: response.detail };
			default:
				return { ok: false, reason: 'unknown', detail: response.detail };
		}
	}

	private async _getToken(): Promise<string | undefined> {
		try {
			const sessions = await this._authenticationService.getSessions(AUTH_PROVIDER_ID, AUTH_SCOPES);
			return sessions[0]?.accessToken;
		} catch (error) {
			this._logService.warn('[Checkpoints] Could not read the GitHub sign-in.', error instanceof Error ? error.message : String(error));
			return undefined;
		}
	}

	private async _send(method: 'POST' | 'PUT', path: string, token: string, body: object): Promise<
		| { kind: 'network-error'; detail: string }
		| { kind: 'response'; status: number; text: string; json: unknown; detail: string }
	> {
		let context;
		try {
			context = await this._requestService.request({
				type: method,
				url: API_ROOT + path,
				headers: {
					'Accept': 'application/vnd.github+json',
					'Authorization': `Bearer ${token}`,
					'Content-Type': 'application/json',
					'X-GitHub-Api-Version': '2022-11-28',
				},
				data: JSON.stringify(body),
				callSite: 'positronCheckpoints.github',
			}, CancellationToken.None);
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			this._logService.warn(`[Checkpoints] GitHub ${method} ${path} could not connect.`, detail);
			return { kind: 'network-error', detail };
		}

		const status = context.res.statusCode ?? 0;
		let text = '';
		let json: unknown;
		try {
			if (status >= 200 && status < 300) {
				json = await asJson(context);
			} else {
				text = (await asText(context)) ?? '';
			}
		} catch (error) {
			this._logService.warn(`[Checkpoints] GitHub ${method} ${path} returned an unreadable reply.`, error instanceof Error ? error.message : String(error));
		}
		const detail = describeReply(status, text);
		this._logService.info(`[Checkpoints] GitHub ${method} ${path} returned ${status}.`);
		return { kind: 'response', status, text, json, detail };
	}
}

function describeReply(status: number, text: string): string {
	let message = '';
	try {
		const body = JSON.parse(text) as GitHubErrorBody;
		const parts = [body.message, ...(body.errors ?? []).map(error => error.message)];
		message = parts.filter((part): part is string => typeof part === 'string' && part.length > 0).join(' ');
	} catch {
		message = text;
	}
	const detail = message ? `GitHub replied ${status}: ${message}` : `GitHub replied ${status}.`;
	return detail.length > MAX_DETAIL_LENGTH ? detail.slice(0, MAX_DETAIL_LENGTH) : detail;
}
