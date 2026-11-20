/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { InstantiationType, registerSingleton } from '../../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { asJson, asText, IRequestService } from '../../../../../platform/request/common/request.js';
import { IAuthenticationService } from '../../../../services/authentication/common/authentication.js';

const API_ROOT = 'https://api.github.com';
const AUTH_PROVIDER_ID = 'github';
const AUTH_SCOPES = ['repo'];
const MAX_DETAIL_LENGTH = 300;

/**
 * Why a request to create a project failed. `maybe-created` and `offline` leave it unknown
 * whether GitHub created the project: GitHub did not answer, or its answer could not be used.
 */
export type CreateRepositoryFailure = 'sign-in-required' | 'name-taken' | 'not-allowed' | 'offline' | 'maybe-created' | 'unknown';
export type InviteFailure = 'no-such-user' | 'not-allowed' | 'sign-in-required' | 'unknown';

export type CreateRepositoryResult =
	| { ok: true; cloneUrl: string; htmlUrl: string }
	| { ok: false; reason: CreateRepositoryFailure; detail: string };

export type InviteResult =
	| { ok: true }
	| { ok: false; reason: InviteFailure; detail: string };

export type ProposalState = 'waiting' | 'changes-requested' | 'approved' | 'accepted' | 'closed';
export type ProposalFailure = 'sign-in-required' | 'not-allowed' | 'offline' | 'unknown';

export interface ProposalInfo {
	number: number;
	url: string;
	state: ProposalState;
	overlapsShared: boolean;
	headCommit: string;
}

export type OpenProposalResult =
	| { ok: true; url: string; number: number }
	| { ok: false; reason: ProposalFailure | 'already-open'; detail: string };

export type FindProposalResult =
	| { ok: true; proposal?: ProposalInfo }
	| { ok: false; reason: ProposalFailure; detail: string };

export type CloseProposalResult =
	| { ok: true }
	| { ok: false; reason: ProposalFailure; detail: string };

export interface ProjectLink {
	owner: string;
	name: string;
	cloneUrl: string;
}

/**
 * The GitHub calls that sharing a project needs. Every call is made after a click.
 */
export interface IGitHubClient {
	readonly _serviceBrand: undefined;
	createRepository(name: string, isPrivate: boolean, owner?: string): Promise<CreateRepositoryResult>;
	invite(owner: string, name: string, login: string): Promise<InviteResult>;
	parseProjectLink(text: string): ProjectLink | undefined;
	openProposal(owner: string, name: string, branch: string, base: string, title: string, body: string): Promise<OpenProposalResult>;
	findProposal(owner: string, name: string, branch: string): Promise<FindProposalResult>;
	closeProposal(owner: string, name: string, number: number): Promise<CloseProposalResult>;
}

export const IGitHubClient = createDecorator<IGitHubClient>('positronCheckpointsGitHubClient');

export const EMAIL_NOT_ACCEPTED_DETAIL = 'Enter the person\'s GitHub user name.';

const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9]))*$/;
const MAX_OWNER_LENGTH = 39;
const NAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const MAX_NAME_LENGTH = 100;

/** The reviews GitHub returns on one page, and the most pages of reviews read for one proposal. */
const REVIEWS_PER_PAGE = 100;
const MAX_REVIEW_PAGES = 10;

const LINK_PATTERNS: RegExp[] = [
	/^https?:\/\/(?:www\.)?github\.com\/(?<owner>[^/\s]+)\/(?<name>[^/\s]+?)\/?$/i,
	/^git@github\.com:(?<owner>[^/\s]+)\/(?<name>[^/\s]+)$/i,
	/^(?<owner>[^/\s:@.]+)\/(?<name>[^/\s:@]+)$/,
];

function isValidOwner(owner: string): boolean {
	return owner.length <= MAX_OWNER_LENGTH && OWNER_PATTERN.test(owner);
}

/** A GitHub user name follows the same rules as the name of an owner. */
function isValidLogin(login: string): boolean {
	return isValidOwner(login);
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

interface PullRequestSummary {
	number?: unknown;
	html_url?: unknown;
	state?: unknown;
	merged_at?: unknown;
	mergeable_state?: unknown;
	head?: { sha?: unknown };
}

interface PullRequestReview {
	state?: unknown;
	user?: { login?: unknown } | null;
}

type GitHubReply =
	| { kind: 'network-error'; detail: string }
	| { kind: 'response'; status: number; text: string; json: unknown; detail: string };

/** Maps a reply that is not a success to the failure reasons of the proposal calls. */
function proposalFailure(response: GitHubReply): { ok: false; reason: ProposalFailure; detail: string } {
	if (response.kind === 'network-error') {
		return { ok: false, reason: 'offline', detail: response.detail };
	}
	switch (response.status) {
		case 401:
			return { ok: false, reason: 'sign-in-required', detail: response.detail };
		case 403:
		case 404:
			return { ok: false, reason: 'not-allowed', detail: response.detail };
		default:
			return { ok: false, reason: 'unknown', detail: response.detail };
	}
}

function isSuccess(response: GitHubReply): response is Extract<GitHubReply, { kind: 'response' }> {
	return response.kind === 'response' && response.status >= 200 && response.status < 300;
}

/** The state of an open proposal from its reviews: the latest review of each person decides. */
function stateFromReviews(reviews: PullRequestReview[]): ProposalState {
	const latest = new Map<string, string>();
	for (const review of reviews) {
		if (typeof review.user?.login !== 'string' || typeof review.state !== 'string') {
			continue;
		}
		if (review.state === 'APPROVED' || review.state === 'CHANGES_REQUESTED') {
			latest.set(review.user.login, review.state);
		}
	}
	const states = [...latest.values()];
	if (states.includes('CHANGES_REQUESTED')) {
		return 'changes-requested';
	}
	return states.includes('APPROVED') ? 'approved' : 'waiting';
}

/**
 * Calls the GitHub REST API with the person's existing GitHub sign-in. It never starts a
 * sign-in itself, and it never writes the token to a log.
 */
export class GitHubClient implements IGitHubClient {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IAuthenticationService private readonly _authenticationService: IAuthenticationService,
		@IRequestService private readonly _requestService: IRequestService,
		@ILogService private readonly _logService: ILogService,
	) { }

	parseProjectLink(text: string): ProjectLink | undefined {
		return parseProjectLink(text);
	}

	async createRepository(name: string, isPrivate: boolean, owner?: string): Promise<CreateRepositoryResult> {
		if (owner && !isValidOwner(owner)) {
			return { ok: false, reason: 'not-allowed', detail: 'The organization name is not one GitHub allows.' };
		}
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
				// GitHub created the project but its reply cannot be read, so the links come from the
				// validated names. A personal project is under the signed-in user's login.
				const links = await this._linksFromNames(owner, name, token);
				return links
					? { ok: true, ...links }
					: { ok: false, reason: 'maybe-created', detail: 'GitHub did not return the new project links.' };
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
		if (!isValidLogin(login)) {
			return { ok: false, reason: 'no-such-user', detail: 'The user name is not one GitHub allows.' };
		}
		if (!isValidOwner(owner) || !isValidName(name)) {
			return { ok: false, reason: 'not-allowed', detail: 'The project name is not one GitHub allows.' };
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

	async openProposal(owner: string, name: string, branch: string, base: string, title: string, body: string): Promise<OpenProposalResult> {
		if (!isValidOwner(owner) || !isValidName(name)) {
			return { ok: false, reason: 'not-allowed', detail: 'The project name is not one GitHub allows.' };
		}
		const token = await this._getToken();
		if (token === undefined) {
			return { ok: false, reason: 'sign-in-required', detail: 'No GitHub sign-in.' };
		}
		const response = await this._send('POST', `${pullsPath(owner, name)}`, token, { head: branch, base, title, body });
		if (response.kind === 'response') {
			if (response.status >= 200 && response.status < 300) {
				const created = response.json as Partial<PullRequestSummary> | undefined;
				if (typeof created?.html_url === 'string' && typeof created.number === 'number') {
					return { ok: true, url: created.html_url, number: created.number };
				}
				return { ok: false, reason: 'unknown', detail: 'GitHub did not return the new review request.' };
			}
			if (response.status === 422 && /pull request already exists/i.test(response.text)) {
				return { ok: false, reason: 'already-open', detail: response.detail };
			}
		}
		return proposalFailure(response);
	}

	async findProposal(owner: string, name: string, branch: string): Promise<FindProposalResult> {
		if (!isValidOwner(owner) || !isValidName(name)) {
			return { ok: false, reason: 'not-allowed', detail: 'The project name is not one GitHub allows.' };
		}
		const token = await this._getToken();
		if (token === undefined) {
			return { ok: false, reason: 'sign-in-required', detail: 'No GitHub sign-in.' };
		}
		const head = encodeURIComponent(`${owner}:${branch}`);
		const listed = await this._send('GET', `${pullsPath(owner, name)}?head=${head}&state=all&sort=created&direction=desc&per_page=1`, token);
		if (!isSuccess(listed)) {
			return proposalFailure(listed);
		}
		if (!Array.isArray(listed.json)) {
			return { ok: false, reason: 'unknown', detail: 'GitHub returned a list that could not be read.' };
		}
		if (listed.json.length === 0) {
			return { ok: true };
		}
		const item = listed.json[0] as PullRequestSummary;
		if (typeof item.number !== 'number' || typeof item.html_url !== 'string' || typeof item.head?.sha !== 'string') {
			return { ok: false, reason: 'unknown', detail: 'GitHub returned a review request that could not be read.' };
		}
		const common = { number: item.number, url: item.html_url, headCommit: item.head.sha };
		if (typeof item.merged_at === 'string') {
			return { ok: true, proposal: { ...common, state: 'accepted', overlapsShared: false } };
		}
		if (item.state === 'closed') {
			return { ok: true, proposal: { ...common, state: 'closed', overlapsShared: false } };
		}

		const detailPath = `${pullsPath(owner, name)}/${item.number}`;
		const detail = await this._send('GET', detailPath, token);
		if (!isSuccess(detail)) {
			return proposalFailure(detail);
		}
		const overlapsShared = (detail.json as PullRequestSummary | undefined)?.mergeable_state === 'dirty';
		// GitHub lists reviews oldest first, so every page is read to find the latest decisions.
		const reviews: PullRequestReview[] = [];
		for (let page = 1; page <= MAX_REVIEW_PAGES; page++) {
			const response = await this._send('GET', `${detailPath}/reviews?per_page=${REVIEWS_PER_PAGE}&page=${page}`, token);
			if (!isSuccess(response)) {
				return proposalFailure(response);
			}
			if (!Array.isArray(response.json)) {
				return { ok: false, reason: 'unknown', detail: 'GitHub returned reviews that could not be read.' };
			}
			reviews.push(...response.json as PullRequestReview[]);
			if (response.json.length < REVIEWS_PER_PAGE) {
				break;
			}
		}
		return { ok: true, proposal: { ...common, state: stateFromReviews(reviews), overlapsShared } };
	}

	async closeProposal(owner: string, name: string, number: number): Promise<CloseProposalResult> {
		if (!isValidOwner(owner) || !isValidName(name) || !Number.isInteger(number) || number <= 0) {
			return { ok: false, reason: 'not-allowed', detail: 'The project name is not one GitHub allows.' };
		}
		const token = await this._getToken();
		if (token === undefined) {
			return { ok: false, reason: 'sign-in-required', detail: 'No GitHub sign-in.' };
		}
		const response = await this._send('PATCH', `${pullsPath(owner, name)}/${number}`, token, { state: 'closed' });
		return isSuccess(response) ? { ok: true } : proposalFailure(response);
	}

	/** The links of a project named `name` under `owner`, or under the signed-in user when `owner` is empty. */
	private async _linksFromNames(owner: string | undefined, name: string, token: string): Promise<{ cloneUrl: string; htmlUrl: string } | undefined> {
		let login = owner;
		if (!login) {
			const response = await this._send('GET', '/user', token);
			const user = response.kind === 'response' ? response.json as { login?: unknown } | undefined : undefined;
			login = typeof user?.login === 'string' ? user.login : undefined;
		}
		const link = login !== undefined && isValidName(name) ? parseProjectLink(`${login}/${name}`) : undefined;
		return link ? { cloneUrl: link.cloneUrl, htmlUrl: `https://github.com/${link.owner}/${link.name}` } : undefined;
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

	private async _send(method: 'GET' | 'POST' | 'PUT' | 'PATCH', path: string, token: string, body?: object): Promise<GitHubReply> {
		let context;
		try {
			context = await this._requestService.request({
				type: method,
				url: API_ROOT + path,
				headers: {
					'Accept': 'application/vnd.github+json',
					'Authorization': `Bearer ${token}`,
					...(body ? { 'Content-Type': 'application/json' } : {}),
					'X-GitHub-Api-Version': '2022-11-28',
				},
				data: body ? JSON.stringify(body) : undefined,
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

function pullsPath(owner: string, name: string): string {
	return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/pulls`;
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

registerSingleton(IGitHubClient, GitHubClient, InstantiationType.Delayed);
