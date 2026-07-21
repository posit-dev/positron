/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { createWriteStream } from 'fs';
import { mkdir, rename, unlink } from 'fs/promises';
import { dirname } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { Logger, NULL_LOGGER } from './logging.js';
import { parsePinMeta, PinMeta } from './meta.js';

/** The default per-request timeout, in milliseconds. */
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * The maximum number of pins the legacy applications endpoint returns in one request. This matches
 * what the pins packages request; servers with more than this many visible pins would truncate.
 */
const PIN_LIST_COUNT = 1000;

/**
 * A pin as returned by the enumeration endpoint. `activeBundleId` is the id of the pin's current
 * version, used to fetch its metadata and, later, its data.
 */
export interface PinInfo {
	/** The content GUID that uniquely identifies the pin on the server. */
	guid: string;
	/** The bare pin name (the user-facing full name is `ownerUsername/name`). */
	name: string;
	/** The username of the pin's owner, used to group pins in the tree. */
	ownerUsername: string;
	/** The pin title, if set. */
	title: string;
	/** The pin description, if set. */
	description: string;
	/** The id of the pin's active bundle (version), as a string. */
	activeBundleId: string;
}

/**
 * A single version (bundle) of a pin, as returned by the bundles endpoint. The `id` doubles as the
 * `_rev<id>` segment used to read a specific version's files.
 */
export interface BundleInfo {
	/** The bundle id, as a string. Also the `_rev<id>` segment in the version's file URLs. */
	id: string;
	/** The bundle creation timestamp, as an ISO 8601 string (e.g. "2024-01-15T09:30:00Z"). */
	createdTime: string;
	/** Whether this bundle is the pin's active (currently served) version. */
	active: boolean;
	/** The bundle size in bytes, when recorded. */
	size?: number;
}

/** The subset of the server settings response this driver reads. */
export interface ServerSettings {
	/** The Connect server version, e.g. "2024.01.0". */
	version?: string;
}

/** The subset of the current-user response this driver reads. */
export interface CurrentUser {
	/** The authenticated user's username. */
	username: string;
}

/** The shape of a single item in the legacy applications endpoint response. */
interface RawApplication {
	guid?: string;
	name?: string;
	owner_username?: string;
	title?: string;
	description?: string;
	bundle_id?: string | number;
}

/** The applications endpoint response envelope. */
interface RawApplicationsResponse {
	applications?: RawApplication[];
}

/** The shape of a single item in the content bundles endpoint response. */
interface RawBundle {
	id?: string | number;
	created_time?: string;
	active?: boolean;
	size?: number;
}

/**
 * Normalizes a Connect server URL: defaults a missing scheme to `https://`, then strips a trailing
 * `__api__/` segment and any trailing slashes. Matches what the pins packages accept, so a bare host
 * like `connect.example.com` (as entered in `board_connect(server = ...)`) works verbatim.
 *
 * @param serverUrl The raw server URL entered by the user.
 * @returns The normalized base URL, with a scheme and without a trailing slash.
 */
export function normalizeServerUrl(serverUrl: string): string {
	let url = serverUrl.trim();
	// A bare host (no scheme) gets https://, since fetch requires an absolute URL and Connect is
	// served over HTTPS. An explicit http:// or https:// is left as-is.
	if (url !== '' && !/^https?:\/\//i.test(url)) {
		url = `https://${url}`;
	}
	return url
		.replace(/__api__\/?$/, '')
		.replace(/\/+$/, '');
}

/**
 * A typed HTTP client for the Posit Connect endpoints this driver needs. Every request carries the
 * `Authorization: Key <api_key>` header, so the client acts as the key's owner and sees exactly the
 * content that user can access.
 *
 * The one method that owns the pin-enumeration strategy is {@link listPins}; everything downstream
 * (metadata, and later versions and data files) is independent of how pins are enumerated, so a
 * future switch to the versioned `/v1/content` endpoint is a change to that method alone.
 */
export class ConnectClient {
	/** The normalized server base URL (no trailing slash). */
	private readonly _serverUrl: string;

	/**
	 * @param serverUrl The Connect server URL (normalized on construction).
	 * @param _apiKey The API key sent as `Authorization: Key <api_key>`.
	 * @param _fetch The fetch implementation, injectable for testing; defaults to global fetch.
	 * @param _logger Logs requests and failures; defaults to a no-op logger.
	 */
	constructor(
		serverUrl: string,
		private readonly _apiKey: string,
		private readonly _fetch: typeof fetch = fetch,
		private readonly _logger: Logger = NULL_LOGGER
	) {
		this._serverUrl = normalizeServerUrl(serverUrl);
	}

	/** The normalized server base URL, exposed for code generation and display. */
	get serverUrl(): string {
		return this._serverUrl;
	}

	/**
	 * Fetches the server settings. Used to validate the server URL (a non-Connect URL returns
	 * non-JSON or an error) and to report the server version.
	 */
	async getServerSettings(): Promise<ServerSettings> {
		const json = await this._getJson<ServerSettings>(this._apiUrl('server_settings'));
		return { version: typeof json.version === 'string' ? json.version : undefined };
	}

	/**
	 * Fetches the current user. Used to validate the API key (an invalid key returns 401/403) and to
	 * obtain the username for display.
	 */
	async getCurrentUser(): Promise<CurrentUser> {
		const json = await this._getJson<{ username?: string }>(this._apiUrl('v1/user'));
		return { username: typeof json.username === 'string' ? json.username : '' };
	}

	/**
	 * Lists the pins visible to the API key's owner via the legacy applications endpoint, filtered
	 * server-side to pin content. This single request powers the whole owner -> pin tree.
	 *
	 * @param search Optional server-side search term to narrow the results.
	 */
	async listPins(search?: string): Promise<PinInfo[]> {
		// The colon in the filter value is left unencoded (Connect expects `content_type:pin`);
		// only the optional search term, which is user input, is encoded.
		let query = `filter=content_type:pin&count=${PIN_LIST_COUNT}`;
		if (search) {
			query += `&search=${encodeURIComponent(search)}`;
		}
		const json = await this._getJson<RawApplicationsResponse>(`${this._apiUrl('applications')}?${query}`);
		const applications = Array.isArray(json.applications) ? json.applications : [];
		this._logger.info(`Found ${applications.length} pin(s) on ${this._serverUrl}`);
		return applications
			.filter((app): app is RawApplication & { guid: string; name: string } =>
				typeof app.guid === 'string' && typeof app.name === 'string')
			.map(app => ({
				guid: app.guid,
				name: app.name,
				ownerUsername: app.owner_username ?? '',
				title: app.title ?? '',
				description: app.description ?? '',
				activeBundleId: app.bundle_id !== undefined ? String(app.bundle_id) : '',
			}));
	}

	/**
	 * Lists a pin's versions (bundles) via the documented content bundles endpoint, newest first.
	 * Each version's `id` is also the `_rev<id>` segment used to read that version's files.
	 *
	 * @param guid The pin's content GUID.
	 */
	async listBundles(guid: string): Promise<BundleInfo[]> {
		const json = await this._getJson<RawBundle[]>(this._apiUrl(`v1/content/${encodeURIComponent(guid)}/bundles`));
		const bundles = Array.isArray(json) ? json : [];
		this._logger.info(`Found ${bundles.length} version(s) for pin ${guid}`);
		return bundles
			.filter((bundle): bundle is RawBundle & { id: string | number } => bundle.id !== undefined && bundle.id !== null)
			.map(bundle => ({
				id: String(bundle.id),
				createdTime: typeof bundle.created_time === 'string' ? bundle.created_time : '',
				active: bundle.active === true,
				size: typeof bundle.size === 'number' ? bundle.size : undefined,
			}))
			// Newest first. ISO 8601 timestamps sort lexicographically in chronological order; ties
			// (or missing timestamps) fall back to the numerically larger (newer) bundle id.
			.sort((a, b) => b.createdTime.localeCompare(a.createdTime) || Number(b.id) - Number(a.id));
	}

	/**
	 * Fetches and parses a pin's `data.txt` metadata manifest for a specific bundle. The manifest is
	 * served from the content's own URL (under `/content/`, not `/__api__/`); pins reads it this way
	 * because it works with viewer access, whereas the bundle-download API requires collaborator
	 * access.
	 *
	 * @param guid The pin's content GUID.
	 * @param bundleId The bundle (version) id to read.
	 */
	async getPinMeta(guid: string, bundleId: string): Promise<PinMeta> {
		const url = `${this._serverUrl}/content/${encodeURIComponent(guid)}/_rev${encodeURIComponent(bundleId)}/data.txt`;
		const text = await this._getText(url);
		return parsePinMeta(text);
	}

	/**
	 * Downloads a single data file from a pin version to `destPath`, streamed to disk so a large pin
	 * never materializes in memory. Served from the content's own URL (under `/content/`, matching
	 * {@link getPinMeta}), which works with viewer access. The body is written to a temporary sibling
	 * and renamed into place only on success, so a failed or interrupted download never leaves a
	 * partial file that a later immutable-skip would mistake for a complete one.
	 *
	 * No request timeout is applied: a pin's data file can be large and take longer than the API
	 * timeout to transfer, and the fixed abort would kill an otherwise-healthy download.
	 *
	 * @param guid The pin's content GUID.
	 * @param bundleId The bundle (version) id to read.
	 * @param filename The data file name within the bundle (from the pin's `data.txt`).
	 * @param destPath The absolute path to write the file to.
	 */
	async downloadPinFile(guid: string, bundleId: string, filename: string, destPath: string): Promise<void> {
		const url = `${this._serverUrl}/content/${encodeURIComponent(guid)}/_rev${encodeURIComponent(bundleId)}/${encodeURIComponent(filename)}`;
		this._logger.info(`Downloading ${filename} (${destPath}) for pin ${guid} version ${bundleId}`);
		// GET with no abort timeout; the body may be large.
		const response = await this._get(url, '*/*', 0);
		if (!response.body) {
			throw new Error(`The Connect server returned an empty response body for ${filename}.`);
		}
		await mkdir(dirname(destPath), { recursive: true });
		const tempPath = `${destPath}.download`;
		try {
			await pipeline(Readable.fromWeb(response.body), createWriteStream(tempPath));
			await rename(tempPath, destPath);
		} catch (err) {
			// Best-effort cleanup of the partial file; the original error is what matters.
			await unlink(tempPath).catch(() => { });
			throw err;
		}
	}

	/** Builds a URL under the server's `/__api__/` prefix. */
	private _apiUrl(path: string): string {
		return `${this._serverUrl}/__api__/${path}`;
	}

	/** Performs a GET and parses the response as JSON, mapping errors to clear messages. */
	private async _getJson<T>(url: string): Promise<T> {
		const response = await this._get(url, 'application/json');
		try {
			return await response.json() as T;
		} catch {
			throw new Error(`The Connect server returned an unexpected (non-JSON) response from ${url}. Check that the server URL is correct.`);
		}
	}

	/** Performs a GET and returns the response body as text. */
	private async _getText(url: string): Promise<string> {
		const response = await this._get(url, 'text/plain');
		return response.text();
	}

	/**
	 * Performs a GET request with the auth header and a timeout, returning the response only when it
	 * is successful. Maps transport failures, timeouts, and non-2xx statuses to clear errors.
	 *
	 * @param timeoutMs The abort timeout in milliseconds; pass 0 to disable it (for large downloads
	 * whose transfer can legitimately exceed the API timeout).
	 */
	private async _get(url: string, accept: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<Response> {
		this._logger.trace(`GET ${url}`);
		const controller = new AbortController();
		const timeout = timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
		let response: Response;
		try {
			response = await this._fetch(url, {
				headers: {
					'Authorization': `Key ${this._apiKey}`,
					'Accept': accept,
				},
				signal: controller.signal,
			});
		} catch (err) {
			if (err instanceof Error && err.name === 'AbortError') {
				const message = `Timed out connecting to the Connect server at ${this._serverUrl}.`;
				this._logger.error(message);
				throw new Error(message);
			}
			const detail = err instanceof Error ? err.message : String(err);
			const message = `Could not reach the Connect server at ${this._serverUrl}: ${detail}`;
			this._logger.error(message);
			throw new Error(message);
		} finally {
			clearTimeout(timeout);
		}

		if (!response.ok) {
			const error = await this._responseError(response);
			this._logger.error(`${response.status} for ${url}: ${error.message}`);
			throw error;
		}
		return response;
	}

	/** Maps a non-2xx response to a clear error, distinguishing auth, not-found, and other failures. */
	private async _responseError(response: Response): Promise<Error> {
		if (response.status === 401 || response.status === 403) {
			return new Error(`The Connect server rejected the request (HTTP ${response.status}). Check your API key and its permissions.`);
		}
		if (response.status === 404) {
			return new Error(`The Connect server returned Not Found (HTTP 404). The pin or server URL may be incorrect.`);
		}
		// Summarize the body (if any) to aid diagnosis, keeping it short.
		let body = '';
		try {
			body = (await response.text()).trim().slice(0, 200);
		} catch {
			// Ignore: an unreadable body just yields a status-only message.
		}
		const suffix = body ? `: ${body}` : '';
		return new Error(`The Connect server request failed (HTTP ${response.status})${suffix}`);
	}
}
