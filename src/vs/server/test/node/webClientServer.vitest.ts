/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

/// <reference types="vitest/globals" />

// webClientServer.ts computes APP_ROOT at module load via FileAccess.asFileUri(''), which
// requires globalThis._VSCODE_FILE_ROOT. That's normally set by a bootstrap entry point (see
// agentHostServerMain.ts), which this plain Vitest run doesn't go through -- set it ourselves,
// hoisted above the import so it's in place before webClientServer.ts's top-level code runs.
// Avoids importing the `url` module here since vi.hoisted runs before this file's own imports.
const originalEnv = vi.hoisted(() => {
	const env = {
		RS_SERVER_URL: process.env['RS_SERVER_URL'],
		RSTUDIO_VERSION: process.env['RSTUDIO_VERSION'],
	};
	globalThis._VSCODE_FILE_ROOT = new URL('../../../../..', import.meta.url).pathname;
	process.env['RS_SERVER_URL'] = 'http://workbench.example.com';
	process.env['RSTUDIO_VERSION'] = '2026.05.0';
	return env;
});

// eslint-disable-next-line local/code-no-http-import
import * as http from 'http';
import * as net from 'net';
import * as url from 'url';
import { FileAccess } from '../../../base/common/network.js';
import { mock, mockObject, upcastPartial } from '../../../base/test/common/mock.js';
import { URI } from '../../../base/common/uri.js';
import { ILogService, NullLogService } from '../../../platform/log/common/log.js';
import { IServerEnvironmentService, ServerParsedArgs } from '../../node/serverEnvironmentService.js';
import { IRequestService } from '../../../platform/request/common/request.js';
import { IProductService } from '../../../platform/product/common/productService.js';
import { ICSSDevelopmentService } from '../../../platform/cssDev/node/cssDevService.js';
import { NoneServerConnectionToken } from '../../node/serverConnectionToken.js';
import { WebClientServer } from '../../node/webClientServer.js';
import { ISocketOwnershipCheck } from '../../node/socketOwnership.js';
import { IPositronAcademicLicenseService } from '../../../platform/positronLicense/common/positronAcademicLicenseService.js';

afterAll(() => {
	if (originalEnv.RS_SERVER_URL === undefined) {
		delete process.env['RS_SERVER_URL'];
	} else {
		process.env['RS_SERVER_URL'] = originalEnv.RS_SERVER_URL;
	}
	if (originalEnv.RSTUDIO_VERSION === undefined) {
		delete process.env['RSTUDIO_VERSION'];
	} else {
		process.env['RSTUDIO_VERSION'] = originalEnv.RSTUDIO_VERSION;
	}
});

// None of the tests below exercise real /proc reads -- getListeningPortUid/isProxyPortOwnershipEnforced
// are stubbed via WebClientServer#setSocketOwnershipCheckForTesting -- so, unlike socketOwnership.vitest.ts,
// these run on every platform.

class EmptyRequestService extends mock<IRequestService>() { }
class EmptyProductService extends mock<IProductService>() { }

function createWebClientServer(ownershipCheck: ISocketOwnershipCheck, logService: ILogService = new NullLogService(), args: Partial<ServerParsedArgs> = {}): WebClientServer {
	const webClientServer = new WebClientServer(
		new NoneServerConnectionToken(),
		'/',
		'',
		mockObject<IServerEnvironmentService>()({ args: upcastPartial(args) }) as unknown as IServerEnvironmentService,
		logService,
		new EmptyRequestService(),
		new EmptyProductService(),
		mockObject<ICSSDevelopmentService>()({ isEnabled: false }) as unknown as ICSSDevelopmentService,
		mockObject<IPositronAcademicLicenseService>()({ isAcademic: false }) as unknown as IPositronAcademicLicenseService
	);
	webClientServer.setSocketOwnershipCheckForTesting(ownershipCheck);
	return webClientServer;
}

// Fixed rather than read from the real process: CI containers commonly run as root (uid 0), and
// production code intentionally skips the "ownership check disabled" log when uid === 0 (see
// _verifyProxyPortOwnership), which would make these expectations flake depending on who runs them.
const ourUid = 1000;
const foreignUid = ourUid + 1;

function listen(server: http.Server | net.Server, port: number, host: string): Promise<void> {
	return new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(port, host, () => resolve());
	});
}

async function requestPath(webClientServer: WebClientServer, pathname: string): Promise<{ status: number | undefined; headers: http.IncomingHttpHeaders; body: string }> {
	const frontServer = http.createServer((req, res) => {
		const parsedUrl = url.parse(req.url!, true);
		webClientServer.handle(req, res, parsedUrl, parsedUrl.pathname!);
	});
	try {
		await listen(frontServer, 0, '127.0.0.1');
		const { port } = frontServer.address() as net.AddressInfo;
		return await new Promise((resolve, reject) => {
			http.get(`http://127.0.0.1:${port}${pathname}`, res => {
				let body = '';
				res.on('data', chunk => body += chunk);
				res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
			}).on('error', reject);
		});
	} finally {
		frontServer.close();
	}
}

describe('WebClientServer /proxy/ port ownership gate', () => {
	beforeEach(() => {
		vi.spyOn(process, 'getuid').mockReturnValue(ourUid);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('handle()', () => {

		it('serves the sessionless static callback through the callback handler', async () => {
			const webClientServer = createWebClientServer({
				getListeningPortUid: vi.fn(),
				isProxyPortOwnershipEnforced: vi.fn().mockReturnValue(false),
			});
			const callbackFile = URI.file(`${process.cwd()}/src/vs/code/browser/workbench/callback.html`);
			vi.spyOn(FileAccess, 'asFileUri').mockReturnValue(callbackFile);

			const response = await requestPath(webClientServer, '/positron-static/callback-0/static/out/vs/code/browser/workbench/callback.html');

			expect({
				status: response.status,
				cacheControl: response.headers['cache-control'],
				hasCallbackCsp: typeof response.headers['content-security-policy'] === 'string',
				hasCallbackBody: response.body.includes('vscode-web.url-callbacks'),
			}).toEqual({
				status: 200,
				cacheControl: 'no-store',
				hasCallbackCsp: true,
				hasCallbackBody: true,
			});
		});

		it('rejects with 403 when the port is owned by another uid, and logs a warning', async () => {
			const ownershipCheck: ISocketOwnershipCheck = {
				getListeningPortUid: vi.fn().mockReturnValue(foreignUid),
				isProxyPortOwnershipEnforced: vi.fn().mockReturnValue(true),
			};
			const logService = new NullLogService();
			const warn = vi.spyOn(logService, 'warn');
			const webClientServer = createWebClientServer(ownershipCheck, logService);

			const frontServer = http.createServer((req, res) => {
				const parsedUrl = url.parse(req.url!, true);
				webClientServer.handle(req, res, parsedUrl, parsedUrl.pathname!);
			});
			try {
				await listen(frontServer, 0, '127.0.0.1');
				const { port } = frontServer.address() as net.AddressInfo;

				const response = await new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
					http.get(`http://127.0.0.1:${port}/proxy/9999/`, res => {
						let body = '';
						res.on('data', chunk => body += chunk);
						res.on('end', () => resolve({ status: res.statusCode, body }));
					}).on('error', reject);
				});

				expect({ status: response.status, body: response.body, loggedWarning: warn.mock.calls.length === 1 })
					.toEqual({ status: 403, body: 'Access to the requested port is forbidden.', loggedWarning: true });
			} finally {
				frontServer.close();
			}
		});

		it('proxies through to the backend when the port is owned by our uid', async () => {
			const ownershipCheck: ISocketOwnershipCheck = {
				getListeningPortUid: vi.fn().mockReturnValue(ourUid),
				isProxyPortOwnershipEnforced: vi.fn().mockReturnValue(true),
			};
			const webClientServer = createWebClientServer(ownershipCheck);

			const backendServer = http.createServer((_req, res) => res.end('ok'));
			const frontServer = http.createServer((req, res) => {
				const parsedUrl = url.parse(req.url!, true);
				webClientServer.handle(req, res, parsedUrl, parsedUrl.pathname!);
			});
			try {
				await listen(backendServer, 0, '127.0.0.1');
				const { port: backendPort } = backendServer.address() as net.AddressInfo;
				await listen(frontServer, 0, '127.0.0.1');
				const { port: frontPort } = frontServer.address() as net.AddressInfo;

				const response = await new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
					http.get(`http://127.0.0.1:${frontPort}/proxy/${backendPort}/`, res => {
						let body = '';
						res.on('data', chunk => body += chunk);
						res.on('end', () => resolve({ status: res.statusCode, body }));
					}).on('error', reject);
				});

				expect(response).toEqual({ status: 200, body: 'ok' });
			} finally {
				frontServer.close();
				backendServer.close();
			}
		});

		it('fails open (does not block) when ownership enforcement is unavailable, and logs once', async () => {
			const ownershipCheck: ISocketOwnershipCheck = {
				getListeningPortUid: vi.fn(),
				isProxyPortOwnershipEnforced: vi.fn().mockReturnValue(false),
			};
			const logService = new NullLogService();
			const warn = vi.spyOn(logService, 'warn');
			const webClientServer = createWebClientServer(ownershipCheck, logService);

			const backendServer = http.createServer((_req, res) => res.end('ok'));
			const frontServer = http.createServer((req, res) => {
				const parsedUrl = url.parse(req.url!, true);
				webClientServer.handle(req, res, parsedUrl, parsedUrl.pathname!);
			});
			try {
				await listen(backendServer, 0, '127.0.0.1');
				const { port: backendPort } = backendServer.address() as net.AddressInfo;
				await listen(frontServer, 0, '127.0.0.1');
				const { port: frontPort } = frontServer.address() as net.AddressInfo;

				const response = await new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
					http.get(`http://127.0.0.1:${frontPort}/proxy/${backendPort}/`, res => {
						let body = '';
						res.on('data', chunk => body += chunk);
						res.on('end', () => resolve({ status: res.statusCode, body }));
					}).on('error', reject);
				});

				expect({
					status: response.status,
					body: response.body,
					loggedDisabledWarning: warn.mock.calls.length === 1,
					consultedPortUid: (ownershipCheck.getListeningPortUid as ReturnType<typeof vi.fn>).mock.calls.length > 0,
				}).toEqual({ status: 200, body: 'ok', loggedDisabledWarning: true, consultedPortUid: false });
			} finally {
				frontServer.close();
				backendServer.close();
			}
		});

		for (const disableValue of ['0', 'false']) {
			it(`proxies through without consulting ownership when disabled via --www-proxy-localhost-verify-port-owner=${disableValue}`, async () => {
				const ownershipCheck: ISocketOwnershipCheck = {
					getListeningPortUid: vi.fn().mockReturnValue(foreignUid),
					isProxyPortOwnershipEnforced: vi.fn().mockReturnValue(true),
				};
				const webClientServer = createWebClientServer(ownershipCheck, new NullLogService(), { 'www-proxy-localhost-verify-port-owner': disableValue });

				const backendServer = http.createServer((_req, res) => res.end('ok'));
				const frontServer = http.createServer((req, res) => {
					const parsedUrl = url.parse(req.url!, true);
					webClientServer.handle(req, res, parsedUrl, parsedUrl.pathname!);
				});
				try {
					await listen(backendServer, 0, '127.0.0.1');
					const { port: backendPort } = backendServer.address() as net.AddressInfo;
					await listen(frontServer, 0, '127.0.0.1');
					const { port: frontPort } = frontServer.address() as net.AddressInfo;

					const response = await new Promise<{ status: number | undefined; body: string }>((resolve, reject) => {
						http.get(`http://127.0.0.1:${frontPort}/proxy/${backendPort}/`, res => {
							let body = '';
							res.on('data', chunk => body += chunk);
							res.on('end', () => resolve({ status: res.statusCode, body }));
						}).on('error', reject);
					});

					expect({
						status: response.status,
						body: response.body,
						consultedPortUid: (ownershipCheck.getListeningPortUid as ReturnType<typeof vi.fn>).mock.calls.length > 0,
					}).toEqual({ status: 200, body: 'ok', consultedPortUid: false });
				} finally {
					frontServer.close();
					backendServer.close();
				}
			});
		}
	});

	describe('handleUpgrade()', () => {

		// A minimal but valid WS upgrade request: http-proxy's own checkMethodAndHeader pass destroys the
		// socket for any request that isn't `GET` with an `Upgrade: websocket` header, independent of our
		// ownership gate, so the fake request must satisfy that or the two failure modes are indistinguishable.
		function fakeUpgradeRequest(pathname: string): http.IncomingMessage {
			return mockObject<http.IncomingMessage>()({
				method: 'GET',
				url: pathname,
				headers: { upgrade: 'websocket', connection: 'Upgrade' },
			}) as unknown as http.IncomingMessage;
		}

		async function connectedSocketPair(): Promise<{ server: net.Server; socket: net.Socket }> {
			const server = net.createServer();
			await listen(server, 0, '127.0.0.1');
			const { port } = server.address() as net.AddressInfo;
			const socket = net.connect(port, '127.0.0.1');
			await new Promise<void>((resolve, reject) => {
				socket.once('connect', () => resolve());
				socket.once('error', reject);
			});
			return { server, socket };
		}

		it('destroys the socket when the port is owned by another uid, without reaching the proxy', async () => {
			const ownershipCheck: ISocketOwnershipCheck = {
				getListeningPortUid: vi.fn().mockReturnValue(foreignUid),
				isProxyPortOwnershipEnforced: vi.fn().mockReturnValue(true),
			};
			const webClientServer = createWebClientServer(ownershipCheck);
			const { server, socket } = await connectedSocketPair();

			try {
				await webClientServer.handleUpgrade(fakeUpgradeRequest('/proxy/9999/'), socket, Buffer.alloc(0), '/proxy/9999/');
				expect(socket.destroyed).toBe(true);
			} finally {
				socket.destroy();
				server.close();
			}
		});

		it('does not destroy the socket when the port is owned by our uid', async () => {
			const ownershipCheck: ISocketOwnershipCheck = {
				getListeningPortUid: vi.fn().mockReturnValue(ourUid),
				isProxyPortOwnershipEnforced: vi.fn().mockReturnValue(true),
			};
			const webClientServer = createWebClientServer(ownershipCheck);
			const { server, socket } = await connectedSocketPair();

			try {
				await webClientServer.handleUpgrade(fakeUpgradeRequest('/proxy/9999/'), socket, Buffer.alloc(0), '/proxy/9999/');
				expect(socket.destroyed).toBe(false);
			} finally {
				socket.destroy();
				server.close();
			}
		});
	});
});
