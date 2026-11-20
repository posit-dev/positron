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

	respondWith(response: CannedResponse | Error): void {
		this._next = response;
	}

	async request(options: IRequestOptions, _token: CancellationToken): Promise<IRequestContext> {
		this.requests.push(options);
		if (this._next instanceof Error) {
			throw this._next;
		}
		const { status, body } = this._next;
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
