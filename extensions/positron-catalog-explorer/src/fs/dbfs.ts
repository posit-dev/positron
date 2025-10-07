/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { basename } from 'path';
import { DatabricksCredentialProvider } from '../credentials';

/**
 * Registers a filesystem provider for the Databricks Unity Catalog.
 */
export function registerDbfsProvider(
	credProvider: DatabricksCredentialProvider,
): vscode.Disposable {
	return vscode.workspace.registerFileSystemProvider(
		DBFS_SCHEME,
		new DatabricksFileProvider(credProvider),
		{ isCaseSensitive: true, isReadonly: true },
	);
}

/**
 * Constructs a Databricks Unity Catalog URI for the given path.
 */
export function dbfsUri(workspace: string, path: string): vscode.Uri {
	return vscode.Uri.from({
		scheme: DBFS_SCHEME,
		authority: workspace,
		path: path,
	});
}

/**
 * Constructs a Databricks Unity Catalog URI for the given volume within a
 * schema & catalog.
 */
export function dbfsVolumeUri(
	workspace: string,
	catalog: string,
	schema: string,
	volume: string,
): vscode.Uri {
	return dbfsUri(workspace, `/Volumes/${catalog}/${schema}/${volume}/`);
}

/**
 * Implements a virtual filesystem for the Databricks Unity Catalog.
 */
export class DatabricksFileProvider implements vscode.FileSystemProvider {
	private emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();

	constructor(readonly credProvider: DatabricksCredentialProvider) {}

	onDidChangeFile = this.emitter.event;

	watch(
		_uri: vscode.Uri,
		_options: {
			readonly recursive: boolean;
			readonly excludes: readonly string[];
		},
	): vscode.Disposable {
		// TODO: Implement a basic polling approach.
		throw new Error('Method not implemented.');
	}

	async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
		const client = await this.getFilesClient(uri.authority);
		const entry = await client.getFile(uri.path);
		return {
			type: vscode.FileType.File,
			size: entry.file_size,
			mtime: entry.last_modified,
			ctime: entry.last_modified,
			permissions: vscode.FilePermission.Readonly,
		};
	}

	async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
		const client = await this.getFilesClient(uri.authority);
		const contents = await client.listContents(uri.path);
		return contents.map((f) => [
			f.name,
			f.is_directory ? vscode.FileType.Directory : vscode.FileType.File,
		]);
	}

	async createDirectory(uri: vscode.Uri) {
		const client = await this.getFilesClient(uri.authority);
		await client.createDirectory(uri.path);
	}

	async readFile(uri: vscode.Uri): Promise<Uint8Array> {
		const client = await this.getFilesClient(uri.authority);
		return await client.downloadFile(uri.path);
	}

	async writeFile(
		uri: vscode.Uri,
		content: Uint8Array,
		options: {
			readonly create: boolean;
			readonly overwrite: boolean;
		},
	) {
		const client = await this.getFilesClient(uri.authority);
		await client.uploadFile(uri.path, content, options.overwrite);
	}

	async delete(uri: vscode.Uri, _options: { readonly recursive: boolean }) {
		const client = await this.getFilesClient(uri.authority);
		// TODO: Should we use the DBFS API instead?
		if (uri.path.endsWith('/')) {
			// TODO: Recursive deletion.
			await client.deleteDirectory(uri.path);
		} else {
			await client.deleteFile(uri.path);
		}
	}

	rename(
		_oldUri: vscode.Uri,
		_newUri: vscode.Uri,
		_options: { readonly overwrite: boolean },
	) {
		// This isn't supported by the Databricks Files API.
		// TODO: Use the DBFS API.
		throw new vscode.FileSystemError('Operation not supported');
	}

	private async getFilesClient(
		workspace: string,
	): Promise<DatabricksFilesClient> {
		const token = await this.credProvider.getToken(workspace);
		if (!token) {
			throw vscode.FileSystemError.NoPermissions;
		}
		return new DatabricksFilesClient(`https://${workspace}`, token);
	}
}

/**
 * Partial client for Databricks's "Files" and "DBFS" APIs.
 */
export class DatabricksFilesClient {
	private uri: string;
	private timeout: number;
	private headers: Record<string, string>;

	/**
	 * Create a new Databricks Files client.
	 */
	constructor(uri: string, token: string, timeout?: number) {
		this.uri = uri.endsWith('/') ? uri.slice(0, -1) : uri;
		this.uri += '/api/2.0';
		this.timeout = timeout || 30000;
		this.headers = {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${token}`,
		};
	}

	/**
	 * List files and folders in a directory.
	 */
	async listContents(
		path: string,
		limit: number = 100,
	): Promise<DirectoryEntry[]> {
		// TODO: Paging, if limit > 1000.
		const pageSize = limit > 1000 ? 1000 : limit;
		const contents: ListContentsResponse = await this.fetch(
			this.url(`fs/directories${path}`, {
				page_size: String(pageSize),
			}),
		);
		return contents.contents;
	}

	/**
	 * Create a new directory.
	 */
	async createDirectory(path: string) {
		return await this.fetch(this.url(`fs/directories${path}`), {
			method: 'PUT',
		});
	}

	/**
	 * Delete an empty directory.
	 */
	async deleteDirectory(path: string) {
		return await this.fetch(this.url(`fs/directories${path}`), {
			method: 'DELETE',
		});
	}

	/**
	 * Get file metadata.
	 */
	async getFile(path: string): Promise<DirectoryEntry> {
		const response = await this.fetchRaw(this.url(`fs/files${path}`), {
			method: 'HEAD',
		});
		const length = response.headers.get('content-length');
		const lastModified = response.headers.get('last-modified');
		if (!length || !lastModified) {
			throw new Error('Malformed response headers.');
		}
		return {
			file_size: Number(length),
			is_directory: false,
			last_modified: new Date(lastModified).getTime(),
			name: basename(path),
			path: path,
		};
	}

	/**
	 * Download a file.
	 */
	async downloadFile(path: string): Promise<Uint8Array> {
		const response = await this.fetchRaw(this.url(`fs/files${path}`), {
			// TODO: Is it sensible to expose If-Unmodified-Since
			// and Range support?
			headers: {
				Accept: 'application/octet-stream',
			},
		});
		return new Uint8Array(await response.arrayBuffer());
	}

	/**
	 * Upload a file.
	 */
	async uploadFile(path: string, content: Uint8Array, overwrite = false) {
		await this.fetch(
			this.url(`fs/files${path}`, {
				overwrite: String(overwrite),
			}),
			{
				method: 'PUT',
				headers: {
					'Content-Type': 'application/octet-stream',
				},
				body: content,
			},
		);
	}

	/**
	 * Delete a file.
	 */
	async deleteFile(path: string) {
		return await this.fetch(this.url(`fs/files${path}`), {
			method: 'DELETE',
		});
	}

	/**
	 * Build a fully-qualified URL to the given endpoint.
	 */
	private url(endpoint: string, params?: Record<string, string>): string {
		const url = new URL(`${this.uri}/${endpoint}`);
		if (params) {
			Object.entries(params).forEach(([key, value]) => {
				url.searchParams.append(key, value);
			});
		}
		return url.toString();
	}

	/**
	 * Fetch the given URL and parse the JSON response as T.
	 */
	private async fetch<T>(url: string, options: RequestInit = {}): Promise<T> {
		const response = await this.fetchRaw(url, options);
		if (response.status === 204) {
			return {} as T;
		}
		return (await response.json()) as T;
	}

	/**
	 * Fetch the given URL and return the unparsed response.
	 */
	private async fetchRaw(
		url: string,
		options: RequestInit = {},
	): Promise<Response> {
		// TODO: Is this really a good timeout mechanism?
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), this.timeout);
		try {
			const fetchOptions: RequestInit = {
				...options,
				headers: {
					...this.headers,
					...(options.headers || {}),
				},
				signal: controller.signal,
			};
			const response = await fetch(url, fetchOptions);
			// TODO: Error handling, translate e.g. 404 and 403 to filesystem errors.
			if (!response.ok) {
				throw new Error(`Request failed with status ${response.status}`);
			}
			return response;
		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError') {
				throw new Error(`Request timed out after ${this.timeout}ms`);
			}
			throw error;
		} finally {
			clearTimeout(timeoutId);
		}
	}
}

export interface DirectoryEntry {
	file_size: number;
	is_directory: boolean;
	last_modified: number;
	name: string;
	path: string;
}

interface ListContentsResponse {
	contents: DirectoryEntry[];
	next_page_token?: string;
}

const DBFS_SCHEME = 'dbfs';
