/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

import type { Mock } from 'vitest';
import { VSBuffer, bufferToStream } from '../../../../../base/common/buffer.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { ILogService, NullLogService } from '../../../../../platform/log/common/log.js';
import { IRequestContext, IRequestOptions } from '../../../../../base/parts/request/common/request.js';
import { IRequestService } from '../../../../../platform/request/common/request.js';
import { stubInterface } from '../../../../../test/vitest/stubInterface.js';
import { AuthenticationSession, IAuthenticationService } from '../../../../services/authentication/common/authentication.js';
import { GitHubClient, parseProjectLink } from '../../browser/github/githubClient.js';

const TOKEN = 'secret-token-value';

interface CannedResponse {
	status: number;
	body?: unknown;
}

class FakeRequestService {
	readonly requests: IRequestOptions[] = [];
	private _next: CannedResponse | Error = { status: 200 };
	private readonly _queue: (CannedResponse | Error)[] = [];

	/** Answers the next request with `response`, before the answer of `respondWith`. */
	respondOnceWith(response: CannedResponse | Error): void {
		this._queue.push(response);
	}

	respondWith(response: CannedResponse | Error): void {
		this._next = response;
	}

	async request(options: IRequestOptions, _token: CancellationToken): Promise<IRequestContext> {
		this.requests.push(options);
		const next = this._queue.shift() ?? this._next;
		if (next instanceof Error) {
			throw next;
		}
		const { status, body } = next;
		const text = body === undefined ? '' : JSON.stringify(body);
		return {
			res: { statusCode: status, headers: {} },
			stream: bufferToStream(VSBuffer.fromString(text)),
		};
	}
}

describe('GitHubClient', () => {
	let requests: FakeRequestService;
	let sessions: AuthenticationSession[];
	let getSessions: Mock<IAuthenticationService['getSessions']>;
	let logService: ILogService;
	let client: GitHubClient;

	beforeEach(() => {
		requests = new FakeRequestService();
		sessions = [{ id: 's', accessToken: TOKEN, account: { id: 'a', label: 'person' }, scopes: ['repo'] }];
		getSessions = vi.fn<IAuthenticationService['getSessions']>(async () => sessions);
		logService = new NullLogService();
		client = new GitHubClient(
			stubInterface<IAuthenticationService>({ getSessions }),
			requests as unknown as IRequestService,
			logService,
		);
	});

	describe('createRepository', () => {
		test('creates a repository for the signed-in user', async () => {
			requests.respondWith({ status: 201, body: { clone_url: 'https://github.com/me/proj.git', html_url: 'https://github.com/me/proj' } });
			const result = await client.createRepository('proj', true);
			expect(result).toEqual({ ok: true, cloneUrl: 'https://github.com/me/proj.git', htmlUrl: 'https://github.com/me/proj' });
			expect(getSessions).toHaveBeenCalledWith('github', ['repo']);
			expect(requests.requests).toHaveLength(1);
			expect(requests.requests[0]).toMatchObject({
				type: 'POST',
				url: 'https://api.github.com/user/repos',
				data: JSON.stringify({ name: 'proj', private: true }),
				headers: {
					'Accept': 'application/vnd.github+json',
					'X-GitHub-Api-Version': '2022-11-28',
					'Authorization': `Bearer ${TOKEN}`,
				},
			});
		});

		test('uses the organization endpoint when an owner is given', async () => {
			requests.respondWith({ status: 201, body: { clone_url: 'c', html_url: 'h' } });
			await client.createRepository('proj', false, 'lab');
			expect(requests.requests[0].url).toBe('https://api.github.com/orgs/lab/repos');
			expect(requests.requests[0].data).toBe(JSON.stringify({ name: 'proj', private: false }));
		});

		test('reports a name that is already used', async () => {
			requests.respondWith({
				status: 422,
				body: { message: 'Repository creation failed.', errors: [{ resource: 'Repository', code: 'custom', field: 'name', message: 'name already exists on this account' }] },
			});
			const result = await client.createRepository('proj', true);
			expect(result).toMatchObject({ ok: false, reason: 'name-taken' });
		});

		test('treats another 422 as unknown', async () => {
			requests.respondWith({ status: 422, body: { message: 'Validation Failed', errors: [{ message: 'name is too long' }] } });
			const result = await client.createRepository('proj', true);
			expect(result).toMatchObject({ ok: false, reason: 'unknown' });
		});

		test('reports a rejected sign-in', async () => {
			requests.respondWith({ status: 401, body: { message: 'Bad credentials' } });
			expect(await client.createRepository('proj', true)).toMatchObject({ ok: false, reason: 'sign-in-required' });
		});

		test('reports a refusal', async () => {
			requests.respondWith({ status: 403, body: { message: 'Forbidden' } });
			expect(await client.createRepository('proj', true, 'lab')).toMatchObject({ ok: false, reason: 'not-allowed' });
		});

		test('reports an unexpected status as unknown with the reply text', async () => {
			requests.respondWith({ status: 500, body: { message: 'Server Error' } });
			const result = await client.createRepository('proj', true);
			expect(result).toMatchObject({ ok: false, reason: 'unknown' });
			expect(result.ok === false && result.detail).toContain('Server Error');
		});

		test('an organization name GitHub does not allow is refused without a request', async () => {
			expect(await client.createRepository('proj', true, '../orgs')).toMatchObject({ ok: false, reason: 'not-allowed' });
			expect(requests.requests).toHaveLength(0);
			expect(getSessions).not.toHaveBeenCalled();
		});

		test('a created project whose reply cannot be read gets its links from the organization and the name', async () => {
			requests.respondWith({ status: 201 });
			expect(await client.createRepository('proj', true, 'lab')).toEqual({ ok: true, cloneUrl: 'https://github.com/lab/proj.git', htmlUrl: 'https://github.com/lab/proj' });
			expect(requests.requests).toHaveLength(1);
		});

		test('a created personal project whose reply cannot be read gets its links from the signed-in login', async () => {
			requests.respondOnceWith({ status: 201 });
			requests.respondOnceWith({ status: 200, body: { login: 'me' } });
			expect(await client.createRepository('proj', true)).toEqual({ ok: true, cloneUrl: 'https://github.com/me/proj.git', htmlUrl: 'https://github.com/me/proj' });
			expect(requests.requests.map(request => `${request.type} ${request.url}`)).toEqual(['POST https://api.github.com/user/repos', 'GET https://api.github.com/user']);
		});

		test('a created project whose links cannot be rebuilt says it may exist', async () => {
			requests.respondOnceWith({ status: 201 });
			requests.respondOnceWith({ status: 500 });
			expect(await client.createRepository('proj', true)).toMatchObject({ ok: false, reason: 'maybe-created' });
		});

		test('reports a network error as offline', async () => {
			requests.respondWith(new Error('getaddrinfo ENOTFOUND api.github.com'));
			expect(await client.createRepository('proj', true)).toMatchObject({ ok: false, reason: 'offline' });
		});

		test('returns sign-in-required without a request when there is no session', async () => {
			sessions = [];
			expect(await client.createRepository('proj', true)).toMatchObject({ ok: false, reason: 'sign-in-required' });
			expect(requests.requests).toHaveLength(0);
		});

		test('never writes the token to the details it returns', async () => {
			requests.respondWith({ status: 403, body: { message: 'Forbidden' } });
			const result = await client.createRepository('proj', true);
			expect(JSON.stringify(result)).not.toContain(TOKEN);
		});
	});

	describe('invite', () => {
		test.each([201, 204])('accepts status %i', async status => {
			requests.respondWith({ status });
			expect(await client.invite('me', 'proj', 'friend')).toEqual({ ok: true });
			expect(requests.requests[0]).toMatchObject({
				type: 'PUT',
				url: 'https://api.github.com/repos/me/proj/collaborators/friend',
			});
		});

		test('reports a user that does not exist', async () => {
			requests.respondWith({ status: 404, body: { message: 'Not Found' } });
			expect(await client.invite('me', 'proj', 'nobody')).toMatchObject({ ok: false, reason: 'no-such-user' });
		});

		test('a user name GitHub does not allow is refused without a request', async () => {
			expect(await client.invite('me', 'proj', '../friend')).toMatchObject({ ok: false, reason: 'no-such-user' });
			expect(await client.invite('../me', 'proj', 'friend')).toMatchObject({ ok: false, reason: 'not-allowed' });
			expect(requests.requests).toHaveLength(0);
		});

		test('reports a refusal', async () => {
			requests.respondWith({ status: 403, body: { message: 'Forbidden' } });
			expect(await client.invite('me', 'proj', 'friend')).toMatchObject({ ok: false, reason: 'not-allowed' });
		});

		test('reports a rejected sign-in', async () => {
			requests.respondWith({ status: 401, body: { message: 'Bad credentials' } });
			expect(await client.invite('me', 'proj', 'friend')).toMatchObject({ ok: false, reason: 'sign-in-required' });
		});

		test('reports an unexpected status and a network error as unknown', async () => {
			requests.respondWith({ status: 500 });
			expect(await client.invite('me', 'proj', 'friend')).toMatchObject({ ok: false, reason: 'unknown' });
			requests.respondWith(new Error('offline'));
			expect(await client.invite('me', 'proj', 'friend')).toMatchObject({ ok: false, reason: 'unknown' });
		});

		test('returns sign-in-required without a request when there is no session', async () => {
			sessions = [];
			expect(await client.invite('me', 'proj', 'friend')).toMatchObject({ ok: false, reason: 'sign-in-required' });
			expect(requests.requests).toHaveLength(0);
		});

		test('refuses an email address without a request', async () => {
			expect(await client.invite('me', 'proj', 'friend@example.com')).toEqual({
				ok: false,
				reason: 'no-such-user',
				detail: 'Enter the person\'s GitHub user name.',
			});
			expect(requests.requests).toHaveLength(0);
		});
	});

	describe('proposals', () => {
		const PULL = { number: 7, html_url: 'https://github.com/me/proj/pull/7', state: 'open', merged_at: null, head: { sha: 'abc123' } };
		const PULLS_URL = 'https://api.github.com/repos/me/proj/pulls';

		function respondToOpenProposal(reviews: unknown[], mergeableState = 'clean'): void {
			requests.respondOnceWith({ status: 200, body: [PULL] });
			requests.respondOnceWith({ status: 200, body: { ...PULL, mergeable_state: mergeableState } });
			requests.respondOnceWith({ status: 200, body: reviews });
		}

		describe('openProposal', () => {
			test('creates a pull request and returns its link and number', async () => {
				requests.respondWith({ status: 201, body: { number: 7, html_url: 'https://github.com/me/proj/pull/7' } });
				expect(await client.openProposal('me', 'proj', 'proposal/dose', 'main', 'Title', 'Body')).toEqual({ ok: true, url: 'https://github.com/me/proj/pull/7', number: 7 });
				expect(requests.requests[0]).toMatchObject({
					type: 'POST',
					url: PULLS_URL,
					data: JSON.stringify({ head: 'proposal/dose', base: 'main', title: 'Title', body: 'Body' }),
				});
			});

			test('reports a pull request that already exists', async () => {
				requests.respondWith({ status: 422, body: { message: 'Validation Failed', errors: [{ message: 'A pull request already exists for me:proposal/dose.' }] } });
				expect(await client.openProposal('me', 'proj', 'proposal/dose', 'main', 't', 'b')).toMatchObject({ ok: false, reason: 'already-open' });
			});

			test('treats another 422 as unknown', async () => {
				requests.respondWith({ status: 422, body: { message: 'Validation Failed', errors: [{ message: 'No commits between main and proposal/dose' }] } });
				expect(await client.openProposal('me', 'proj', 'proposal/dose', 'main', 't', 'b')).toMatchObject({ ok: false, reason: 'unknown' });
			});

			test('treats a success reply that cannot be read as unknown', async () => {
				requests.respondWith({ status: 201 });
				expect(await client.openProposal('me', 'proj', 'proposal/dose', 'main', 't', 'b')).toMatchObject({ ok: false, reason: 'unknown' });
			});

			test.each([
				[401, 'sign-in-required'],
				[403, 'not-allowed'],
				[404, 'not-allowed'],
				[500, 'unknown'],
			])('maps status %i to %s', async (status, reason) => {
				requests.respondWith({ status, body: { message: 'x' } });
				expect(await client.openProposal('me', 'proj', 'b', 'main', 't', 'b')).toMatchObject({ ok: false, reason });
			});

			test('maps a network error to offline', async () => {
				requests.respondWith(new Error('offline'));
				expect(await client.openProposal('me', 'proj', 'b', 'main', 't', 'b')).toMatchObject({ ok: false, reason: 'offline' });
			});

			test('without a sign-in it sends no request', async () => {
				sessions = [];
				expect(await client.openProposal('me', 'proj', 'b', 'main', 't', 'b')).toMatchObject({ ok: false, reason: 'sign-in-required' });
				expect(requests.requests).toHaveLength(0);
			});
		});

		describe('findProposal', () => {
			test('returns no proposal when GitHub lists none', async () => {
				requests.respondWith({ status: 200, body: [] });
				expect(await client.findProposal('me', 'proj', 'proposal/dose')).toEqual({ ok: true });
				expect(requests.requests).toHaveLength(1);
				expect(requests.requests[0]).toMatchObject({
					type: 'GET',
					url: `${PULLS_URL}?head=me%3Aproposal%2Fdose&state=all&sort=created&direction=desc&per_page=1`,
				});
			});

			test('a merged pull request is accepted', async () => {
				requests.respondWith({ status: 200, body: [{ ...PULL, state: 'closed', merged_at: '2026-01-01T00:00:00Z' }] });
				expect(await client.findProposal('me', 'proj', 'b')).toEqual({
					ok: true,
					proposal: { number: 7, url: PULL.html_url, state: 'accepted', overlapsShared: false, headCommit: 'abc123' },
				});
				expect(requests.requests).toHaveLength(1);
			});

			test('a closed pull request that was not merged is closed', async () => {
				requests.respondWith({ status: 200, body: [{ ...PULL, state: 'closed' }] });
				expect(await client.findProposal('me', 'proj', 'b')).toMatchObject({ ok: true, proposal: { state: 'closed', overlapsShared: false } });
			});

			test('an open pull request without reviews is waiting', async () => {
				respondToOpenProposal([]);
				expect(await client.findProposal('me', 'proj', 'b')).toEqual({
					ok: true,
					proposal: { number: 7, url: PULL.html_url, state: 'waiting', overlapsShared: false, headCommit: 'abc123' },
				});
				expect(requests.requests.map(request => request.url).slice(1)).toEqual([`${PULLS_URL}/7`, `${PULLS_URL}/7/reviews?per_page=100`]);
			});

			test('comments alone leave the proposal waiting', async () => {
				respondToOpenProposal([{ state: 'COMMENTED', user: { login: 'a' } }]);
				expect(await client.findProposal('me', 'proj', 'b')).toMatchObject({ ok: true, proposal: { state: 'waiting' } });
			});

			test('an approval makes it approved', async () => {
				respondToOpenProposal([{ state: 'APPROVED', user: { login: 'a' } }]);
				expect(await client.findProposal('me', 'proj', 'b')).toMatchObject({ ok: true, proposal: { state: 'approved' } });
			});

			test('a requested change makes it changes-requested even with another approval', async () => {
				respondToOpenProposal([{ state: 'APPROVED', user: { login: 'a' } }, { state: 'CHANGES_REQUESTED', user: { login: 'b' } }]);
				expect(await client.findProposal('me', 'proj', 'b')).toMatchObject({ ok: true, proposal: { state: 'changes-requested' } });
			});

			test('a later approval replaces an earlier change request by the same person', async () => {
				respondToOpenProposal([{ state: 'CHANGES_REQUESTED', user: { login: 'a' } }, { state: 'APPROVED', user: { login: 'a' } }]);
				expect(await client.findProposal('me', 'proj', 'b')).toMatchObject({ ok: true, proposal: { state: 'approved' } });
			});

			test('a comment after a change request does not clear it', async () => {
				respondToOpenProposal([{ state: 'CHANGES_REQUESTED', user: { login: 'a' } }, { state: 'COMMENTED', user: { login: 'a' } }]);
				expect(await client.findProposal('me', 'proj', 'b')).toMatchObject({ ok: true, proposal: { state: 'changes-requested' } });
			});

			test('a dirty merge state sets overlapsShared', async () => {
				respondToOpenProposal([], 'dirty');
				expect(await client.findProposal('me', 'proj', 'b')).toMatchObject({ ok: true, proposal: { overlapsShared: true } });
			});

			test.each([
				[401, 'sign-in-required'],
				[403, 'not-allowed'],
				[404, 'not-allowed'],
				[500, 'unknown'],
			])('maps status %i of the list to %s', async (status, reason) => {
				requests.respondWith({ status, body: { message: 'x' } });
				expect(await client.findProposal('me', 'proj', 'b')).toMatchObject({ ok: false, reason });
			});

			test('maps a failure of the detail request', async () => {
				requests.respondOnceWith({ status: 200, body: [PULL] });
				requests.respondOnceWith({ status: 403, body: { message: 'x' } });
				expect(await client.findProposal('me', 'proj', 'b')).toMatchObject({ ok: false, reason: 'not-allowed' });
			});

			test('maps a failure of the reviews request', async () => {
				requests.respondOnceWith({ status: 200, body: [PULL] });
				requests.respondOnceWith({ status: 200, body: { mergeable_state: 'clean' } });
				requests.respondOnceWith(new Error('offline'));
				expect(await client.findProposal('me', 'proj', 'b')).toMatchObject({ ok: false, reason: 'offline' });
			});

			test('maps a network error to offline', async () => {
				requests.respondWith(new Error('offline'));
				expect(await client.findProposal('me', 'proj', 'b')).toMatchObject({ ok: false, reason: 'offline' });
			});

			test('a list that cannot be read is unknown', async () => {
				requests.respondWith({ status: 200, body: { message: 'odd' } });
				expect(await client.findProposal('me', 'proj', 'b')).toMatchObject({ ok: false, reason: 'unknown' });
			});

			test('without a sign-in it sends no request', async () => {
				sessions = [];
				expect(await client.findProposal('me', 'proj', 'b')).toMatchObject({ ok: false, reason: 'sign-in-required' });
				expect(requests.requests).toHaveLength(0);
			});
		});

		describe('closeProposal', () => {
			test('closes the pull request', async () => {
				requests.respondWith({ status: 200, body: { number: 7 } });
				expect(await client.closeProposal('me', 'proj', 7)).toEqual({ ok: true });
				expect(requests.requests[0]).toMatchObject({
					type: 'PATCH',
					url: `${PULLS_URL}/7`,
					data: JSON.stringify({ state: 'closed' }),
				});
			});

			test.each([
				[401, 'sign-in-required'],
				[403, 'not-allowed'],
				[404, 'not-allowed'],
				[500, 'unknown'],
			])('maps status %i to %s', async (status, reason) => {
				requests.respondWith({ status, body: { message: 'x' } });
				expect(await client.closeProposal('me', 'proj', 7)).toMatchObject({ ok: false, reason });
			});

			test('maps a network error to offline', async () => {
				requests.respondWith(new Error('offline'));
				expect(await client.closeProposal('me', 'proj', 7)).toMatchObject({ ok: false, reason: 'offline' });
			});

			test('without a sign-in it sends no request', async () => {
				sessions = [];
				expect(await client.closeProposal('me', 'proj', 7)).toMatchObject({ ok: false, reason: 'sign-in-required' });
				expect(requests.requests).toHaveLength(0);
			});
		});

		test('never writes the token to the details it returns', async () => {
			requests.respondWith({ status: 403, body: { message: 'Forbidden' } });
			expect(JSON.stringify(await client.findProposal('me', 'proj', 'b'))).not.toContain(TOKEN);
		});
	});

	describe('parseProjectLink', () => {
		const expected = { owner: 'o', name: 'n', cloneUrl: 'https://github.com/o/n.git' };

		test.each([
			'https://github.com/o/n',
			'https://github.com/o/n.git',
			'https://github.com/o/n/',
			'  https://github.com/o/n  ',
			'git@github.com:o/n.git',
			'o/n',
		])('reads %j', text => {
			expect(parseProjectLink(text)).toEqual(expected);
			expect(client.parseProjectLink(text)).toEqual(expected);
		});

		test('keeps dots, underscores, and digits in names', () => {
			expect(parseProjectLink('lab-1/my_proj.v2')).toEqual({ owner: 'lab-1', name: 'my_proj.v2', cloneUrl: 'https://github.com/lab-1/my_proj.v2.git' });
		});

		test.each([
			'',
			'not a link',
			'https://example.com/o/n',
			'https://github.com/o',
			'https://github.com/o/n/issues/3',
			'o/n/extra',
			'-o/n',
			'o--/n?',
			'o_x/n',
			'o/..',
			'o/n m',
			'o/n;rm',
			'github.com/o/n',
		])('rejects %j', text => {
			expect(parseProjectLink(text)).toBeUndefined();
		});
	});
});
