/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'crypto';
import * as fs from 'fs';
import type * as positron from 'positron';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { dirname as pathDirname } from '../../../../base/common/path.js';
import { isWorkbench } from '../../../../base/common/platform.js';
import { dirname, joinPath } from '../../../../base/common/resources.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import * as pfs from '../../../../base/node/pfs.js';
import { extract } from '../../../../base/node/zip.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import product from '../../../../platform/product/common/product.js';
import { DocsProfile, IDocsBundleRequest } from '../../../../platform/positronDocs/common/positronDocsBundle.js';
import { PositronDocsCache } from '../../../../platform/positronDocs/common/positronDocsCache.js';
import { IDocsArchive, IDocsFileStore, IDocsHttpClient, IDocsHttpGetOptions, IDocsHttpResponse } from '../../../../platform/positronDocs/common/positronDocsIO.js';
import { AI_ENABLED_KEY } from '../../../contrib/positronAssistant/common/positronAIConfigurationKeys.js';
import { IExtHostConfiguration } from '../../common/extHostConfiguration.js';
import { IExtHostInitDataService } from '../../common/extHostInitDataService.js';
import { IExtHostDocs } from '../../common/positron/extHostDocs.js';

const CACHE_DIR_NAME = 'positron-docs';
const DEFAULT_BUNDLE_BASE_URL = 'https://cdn.posit.co/positron/releases/docs';
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 3;

/**
 * HTTP over node's https/http. The extension host already proxy-patches these
 * modules, so enterprise proxies work with no extra code here.
 */
class NodeDocsHttpClient implements IDocsHttpClient {

	async get(url: string, options: IDocsHttpGetOptions = {}): Promise<IDocsHttpResponse> {
		return await this._request(url, 'GET', options, 0);
	}

	async head(url: string): Promise<IDocsHttpResponse> {
		return await this._request(url, 'HEAD', {}, 0);
	}

	private async _request(url: string, method: 'GET' | 'HEAD', options: IDocsHttpGetOptions, redirects: number): Promise<IDocsHttpResponse> {
		// Dynamically imported: http and https are slow to load, so the layer
		// rules only allow them as type imports at module scope.
		const { request: sendRequest } = url.startsWith('http:') ? await import('http') : await import('https');
		return await new Promise<IDocsHttpResponse>((resolve, reject) => {
			const headers: Record<string, string> = {};
			if (options.etag) {
				headers['If-None-Match'] = options.etag;
			}
			const request = sendRequest(url, { method, headers, timeout: REQUEST_TIMEOUT_MS }, response => {
				const status = response.statusCode ?? 0;
				const location = response.headers.location;

				if (status >= 300 && status < 400 && location) {
					response.resume();
					if (redirects >= MAX_REDIRECTS) {
						reject(new Error(`too many redirects for ${url}`));
						return;
					}
					resolve(this._request(new URL(location, url).toString(), method, options, redirects + 1));
					return;
				}

				const etag = typeof response.headers.etag === 'string' ? response.headers.etag : undefined;
				if (method === 'HEAD' || status === 304 || status !== 200) {
					response.resume();
					resolve({ status, etag });
					return;
				}

				const chunks: Buffer[] = [];
				let total = 0;
				response.on('data', (chunk: Buffer) => {
					total += chunk.length;
					if (options.maxBytes !== undefined && total > options.maxBytes) {
						// A wrong or hostile object must not be able to fill the disk.
						request.destroy();
						reject(new Error(`response from ${url} exceeds ${options.maxBytes} bytes`));
						return;
					}
					chunks.push(chunk);
				});
				response.on('end', () => resolve({ status, etag, body: new Uint8Array(Buffer.concat(chunks)) }));
				response.on('error', reject);
			});
			request.on('timeout', () => request.destroy(new Error(`request to ${url} timed out`)));
			request.on('error', reject);
			request.end();
		});
	}
}

class NodeDocsFileStore implements IDocsFileStore {

	async exists(target: string): Promise<boolean> {
		return await pfs.Promises.exists(target);
	}

	async readFile(target: string): Promise<string> {
		return await fs.promises.readFile(target, 'utf8');
	}

	async writeFile(target: string, data: string | Uint8Array): Promise<void> {
		await fs.promises.mkdir(pathDirname(target), { recursive: true });
		await pfs.Promises.writeFile(target, data);
	}

	async mkdir(target: string): Promise<void> {
		await fs.promises.mkdir(target, { recursive: true });
	}

	async rename(from: string, to: string): Promise<void> {
		await pfs.Promises.rename(from, to);
	}

	async delete(target: string): Promise<void> {
		await pfs.Promises.rm(target);
	}

	/** Empty array for a missing path, which is what the port promises. */
	async readdir(target: string): Promise<string[]> {
		try {
			return await pfs.Promises.readdir(target);
		} catch {
			return [];
		}
	}

	async isDirectory(target: string): Promise<boolean> {
		try {
			return (await fs.promises.stat(target)).isDirectory();
		} catch {
			return false;
		}
	}

	async sha256(target: string): Promise<string> {
		return createHash('sha256').update(await fs.promises.readFile(target)).digest('hex');
	}
}

class NodeDocsArchive implements IDocsArchive {

	/**
	 * List entries without extracting, so the traversal guard runs first.
	 *
	 * base/node/zip.ts does not export an entry-listing helper, and its own
	 * check (`targetDirName.startsWith(targetPath)`) is a prefix test that
	 * ignores the final path segment. The archive arrives over the network, so
	 * we open it with yauzl ourselves and assert before writing anything.
	 */
	async entryNames(zipPath: string): Promise<string[]> {
		const { open } = await import('yauzl');
		return await new Promise<string[]>((resolve, reject) => {
			open(zipPath, { lazyEntries: true }, (error, zipfile) => {
				if (error || !zipfile) {
					reject(error ?? new Error(`could not open ${zipPath}`));
					return;
				}
				const names: string[] = [];
				zipfile.on('entry', entry => {
					names.push(entry.fileName);
					zipfile.readEntry();
				});
				zipfile.on('end', () => resolve(names));
				zipfile.on('error', reject);
				zipfile.readEntry();
			});
		});
	}

	async extract(zipPath: string, targetPath: string): Promise<void> {
		await extract(zipPath, targetPath, {}, CancellationToken.None);
	}
}

/**
 * Work out what this build should ask the CDN for.
 *
 * Exported as a free function so it is testable without constructing the
 * service or reaching into its internals.
 */
export function deriveBundleRequest(initData: IExtHostInitDataService, env: NodeJS.ProcessEnv): IDocsBundleRequest {
	const override = env['POSITRON_LLMS_DOCS_URL'];
	return {
		quality: initData.quality,
		positronVersion: initData.positronVersion,
		positronBuildNumber: initData.positronBuildNumber,
		// isWorkbench is already `!!process.env.RS_SERVER_URL` on the node side.
		profile: (isWorkbench ? 'workbench' : 'positron') as DocsProfile,
		baseUrl: (override && override.length > 0)
			? override
			: (product.positronLlmsDocsUrl ?? DEFAULT_BUNDLE_BASE_URL),
	};
}

export class NodeExtHostDocs extends Disposable implements IExtHostDocs {

	readonly _serviceBrand: undefined;

	private readonly _cache: PositronDocsCache;
	private readonly _request: IDocsBundleRequest;

	constructor(
		@IExtHostInitDataService initData: IExtHostInitDataService,
		@IExtHostConfiguration private readonly _configuration: IExtHostConfiguration,
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		// A sibling of globalStorage, so there is no risk of colliding with an
		// extension id. Profile-scoped, which is one 655KB copy per profile.
		const root = joinPath(dirname(initData.environment.globalStorageHome), CACHE_DIR_NAME);

		this._request = deriveBundleRequest(initData, process.env);
		this._cache = new PositronDocsCache({
			rootPath: root.fsPath,
			http: new NodeDocsHttpClient(),
			files: new NodeDocsFileStore(),
			archive: new NodeDocsArchive(),
			logger: {
				info: message => this._logService.info(message),
				warn: message => this._logService.warn(message),
			},
			now: () => Date.now(),
			newId: () => generateUuid(),
		});
	}

	async getLocalDocs(): Promise<positron.docs.LocalDocs | undefined> {
		if (!await this._isAiEnabled()) {
			return undefined;
		}
		return await this._cache.ensure(this._request);
	}

	/**
	 * Read live rather than caching at construction: ai.enabled is
	 * WINDOW-scoped and toggles without a reload, so a value captured once in
	 * the constructor goes stale.
	 */
	private async _isAiEnabled(): Promise<boolean> {
		const provider = await this._configuration.getConfigProvider();
		return provider.getConfiguration().get<boolean>(AI_ENABLED_KEY) === true;
	}
}
