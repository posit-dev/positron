/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

/**
 * A table or namespace identifier, which is a dot-separated string or an array
 * of strings.
 */
export type Identifier = string | string[];

/**
 * A named identifier under a namespace.
 */
export interface NamespacedIdentifier {
	catalog: string;
	schema: string;
	name: string;
}

/**
 * Authentication options for the Unity Catalog client
 */
export interface UnityCatalogAuthOptions {
	token?: string;
	clientId?: string;
	clientSecret?: string;
}

/**
 * Catalog configuration returned by the server
 */
export interface CatalogConfig {
	defaults: Record<string, string>;
	overrides: Record<string, string>;
}

/**
 * Namespace/Schema representation
 */
export interface Schema {
	name: string;
	catalog_name: string;
	owner?: string;
	comment?: string;
	metastore_id?: string;
	full_name: string;
	created_at?: number;
	created_by?: string;
	updated_at?: number;
	updated_by?: string;
	properties?: Record<string, string>;
}

/**
 * Catalog representation
 */
export interface Catalog {
	name: string;
	owner?: string;
	comment?: string;
	metastore_id?: string;
	created_at?: number;
	created_by?: string;
	updated_at?: number;
	updated_by?: string;
	catalog_type?: string;
	properties?: Record<string, string>;
}

/**
 * Volume representation
 */
export interface Volume {
	name: string;
	catalog_name: string;
	schema_name: string;
	volume_type: string;
	owner?: string;
	comment?: string;
	metastore_id?: string;
	full_name: string;
	storage_location?: string;
	created_at?: number;
	created_by?: string;
	updated_at?: number;
	updated_by?: string;
	volume_id?: string;
	properties?: Record<string, string>;
}

/**
 * Table column representation
 */
export interface TableColumn {
	name: string;
	type_text: string;
	type_json?: string;
	type_name?: string;
	type_precision?: number;
	type_scale?: number;
	type_interval_type?: string | null;
	position: number;
	comment?: string;
	nullable: boolean;
	partition_index?: number | null;
}

/**
 * Table representation
 */
export interface Table {
	name: string;
	catalog_name: string;
	schema_name: string;
	table_type: string;
	data_source_format?: string;
	columns: TableColumn[];
	storage_location?: string;
	owner?: string;
	comment?: string;
	properties?: Record<string, string>;
	metastore_id?: string;
	full_name: string;
	data_access_configuration_id?: string;
	created_at?: number;
	created_by?: string;
	updated_at?: number;
	updated_by?: string;
	table_id?: string;
}

/**
 * Error response.
 */
interface ErrorResponse {
	error: {
		message: string;
		type: string;
		code: number;
	};
}

/**
 * Response for listing schemas
 */
interface ListSchemasResponse {
	schemas: Schema[];
}

/**
 * Response for listing catalogs
 */
interface ListCatalogsResponse {
	catalogs: Catalog[];
}

/**
 * Response for listing tables
 */
interface ListTablesResponse {
	tables?: Table[];
}

/**
 * Response for listing volumes
 */
interface ListVolumesResponse {
	volumes?: Volume[];
}

/**
 * Table creation request
 */
export interface CreateTableRequest {
	name: string;
	catalog_name: string;
	schema_name: string;
	table_type?: string;
	data_source_format?: string;
	columns: TableColumn[];
	storage_location?: string;
	comment?: string;
	properties?: Record<string, string>;
}

/**
 * Volume creation request
 */
export interface CreateVolumeRequest {
	name: string;
	catalog_name: string;
	schema_name: string;
	volume_type: string;
	storage_location?: string;
	comment?: string;
	properties?: Record<string, string>;
}

/**
 * Catalog creation request
 */
export interface CreateCatalogRequest {
	name: string;
	comment?: string;
	properties?: Record<string, string>;
}

/**
 * Schema creation request
 */
export interface CreateSchemaRequest {
	name: string;
	catalog_name: string;
	comment?: string;
	properties?: Record<string, string>;
}

/**
 * Error specialization for the Unity Catalog REST API.
 */
export class UnityCatalogError extends Error {
	override name = 'UnityCatalogAPIError';
	public readonly type: string;
	public readonly code: number;
	public readonly operation: string;

	static async from(
		response: Response,
		operation: string = 'perform operation',
	): Promise<UnityCatalogError> {
		try {
			const body = (await response.json()) as ErrorResponse;
			return new UnityCatalogError(
				`Failed to ${operation}: ${body.error.message}. This may be due to authentication issues.`,
				body.error.type,
				body.error.code,
				operation,
			);
		} catch (_e) {
			return new UnityCatalogError(
				`Failed to ${operation}: Non-JSON response with status ${response.status}. This may be due to authentication issues.`,
				'Unknown',
				response.status,
				operation,
			);
		}
	}

	private constructor(
		message: string,
		type: string,
		code: number,
		operation: string,
	) {
		super(message);
		this.type = type;
		this.code = code;
		this.operation = operation;
	}
}

/**
 * Client options for the Unity Catalog Client
 */
export interface UnityCatalogClientOptions {
	uri: string;
	token?: string;
	auth?: UnityCatalogAuthOptions;
	prefix?: string;
	timeout?: number;
}

/**
 * Client for Unity Catalog REST API.
 */
export class UnityCatalogClient {
	private uri: string;
	private timeout: number;
	private headers: Record<string, string>;

	/**
	 * Create a new Unity Catalog client.
	 */
	constructor(uri: string, token: string, timeout?: number) {
		this.uri = uri.endsWith('/') ? uri.slice(0, -1) : uri;
		this.uri += '/api/2.1/unity-catalog';
		this.timeout = timeout || 30000;
		this.headers = {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${token}`,
		};
	}

	/**
	 * List all catalogs
	 */
	async listCatalogs(): Promise<Catalog[]> {
		const response: ListCatalogsResponse = await this.fetch(
			this.url('catalogs'),
		);
		return response.catalogs;
	}

	/**
	 * Get catalog metadata
	 *
	 * @param name Catalog name
	 */
	async getCatalog(name: string): Promise<Catalog> {
		return await this.fetch(this.url(`catalogs/${name}`));
	}

	/**
	 * Create a new catalog
	 *
	 * @param request Catalog creation request
	 */
	async createCatalog(request: CreateCatalogRequest): Promise<Catalog> {
		return await this.fetch(this.url('catalogs'), {
			method: 'POST',
			body: JSON.stringify(request),
		});
	}

	/**
	 * Update catalog properties
	 *
	 * @param name Catalog name
	 * @param updates Properties to update
	 */
	async updateCatalog(
		name: string,
		updates: Partial<Catalog>,
	): Promise<Catalog> {
		return await this.fetch(this.url(`catalogs/${name}`), {
			method: 'PATCH',
			body: JSON.stringify(updates),
		});
	}

	/**
	 * Delete a catalog
	 *
	 * @param name Catalog name
	 * @param force Whether to forcibly delete the catalog even if it's not empty
	 */
	async deleteCatalog(name: string, force: boolean = false): Promise<void> {
		await this.fetch(
			this.url(`catalogs/${name}`, {
				force: force.toString(),
			}),
			{
				method: 'DELETE',
			},
		);
	}

	// Schema operations

	/**
	 * List all schemas in a catalog.
	 */
	async listSchemas(catalog: string): Promise<Schema[]> {
		const response: ListSchemasResponse = await this.fetch(
			this.url('schemas', { catalog_name: catalog }),
		);
		return response.schemas;
	}

	/**
	 * Get schema metadata
	 *
	 * @param catalogName Catalog name
	 * @param schemaName Schema name
	 */
	async getSchema(catalogName: string, schemaName: string): Promise<Schema> {
		return await this.fetch(
			this.url(`catalogs/${catalogName}/schemas/${schemaName}`),
		);
	}

	/**
	 * Create a new schema
	 *
	 * @param request Schema creation request
	 */
	async createSchema(request: CreateSchemaRequest): Promise<Schema> {
		return await this.fetch(
			this.url(`catalogs/${request.catalog_name}/schemas`),
			{
				method: 'POST',
				body: JSON.stringify(request),
			},
		);
	}

	/**
	 * Update schema properties
	 *
	 * @param catalogName Catalog name
	 * @param schemaName Schema name
	 * @param updates Properties to update
	 */
	async updateSchema(
		catalogName: string,
		schemaName: string,
		updates: Partial<Schema>,
	): Promise<Schema> {
		return await this.fetch(
			this.url(`catalogs/${catalogName}/schemas/${schemaName}`),
			{
				method: 'PATCH',
				body: JSON.stringify(updates),
			},
		);
	}

	/**
	 * Delete a schema
	 *
	 * @param catalogName Catalog name
	 * @param schemaName Schema name
	 * @param force Whether to forcibly delete the schema even if it's not empty
	 */
	async deleteSchema(
		catalogName: string,
		schemaName: string,
		force: boolean = false,
	): Promise<void> {
		await this.fetch(
			this.url(`catalogs/${catalogName}/schemas/${schemaName}`, {
				force: force.toString(),
			}),
			{
				method: 'DELETE',
			},
		);
	}

	// Table operations

	/**
	 * List all tables in a schema.
	 */
	async listTables(catalog: string, schema: string): Promise<Table[]> {
		const response: ListTablesResponse = await this.fetch(
			this.url('tables', {
				catalog_name: catalog,
				schema_name: schema,
			}),
		);
		return response.tables ?? [];
	}

	/**
	 * Get table metadata
	 *
	 * @param catalogName Catalog name
	 * @param schemaName Schema name
	 * @param tableName Table name
	 */
	async getTable(
		catalogName: string,
		schemaName: string,
		tableName: string,
	): Promise<Table> {
		return await this.fetch(
			this.url(
				`catalogs/${catalogName}/schemas/${schemaName}/tables/${tableName}`,
			),
		);
	}

	/**
	 * Create a new table
	 *
	 * @param request Table creation request
	 */
	async createTable(request: CreateTableRequest): Promise<Table> {
		return await this.fetch(
			this.url(
				`catalogs/${request.catalog_name}/schemas/${request.schema_name}/tables`,
			),
			{
				method: 'POST',
				body: JSON.stringify(request),
			},
		);
	}

	/**
	 * Update table properties
	 *
	 * @param catalogName Catalog name
	 * @param schemaName Schema name
	 * @param tableName Table name
	 * @param updates Properties to update
	 */
	async updateTable(
		catalogName: string,
		schemaName: string,
		tableName: string,
		updates: Partial<Table>,
	): Promise<Table> {
		return await this.fetch(
			this.url(
				`catalogs/${catalogName}/schemas/${schemaName}/tables/${tableName}`,
			),
			{
				method: 'PATCH',
				body: JSON.stringify(updates),
			},
		);
	}

	/**
	 * Delete a table
	 *
	 * @param catalogName Catalog name
	 * @param schemaName Schema name
	 * @param tableName Table name
	 */
	async deleteTable(
		catalogName: string,
		schemaName: string,
		tableName: string,
	): Promise<void> {
		await this.fetch(
			this.url(
				`catalogs/${catalogName}/schemas/${schemaName}/tables/${tableName}`,
			),
			{ method: 'DELETE' },
		);
	}

	// Volume operations

	/**
	 * List all volumes in a schema.
	 */
	async listVolumes(catalog: string, schema: string): Promise<Volume[]> {
		const response: ListVolumesResponse = await this.fetch(
			this.url('volumes', {
				catalog_name: catalog,
				schema_name: schema,
			}),
		);
		return response.volumes ?? [];
	}

	/**
	 * Get volume metadata
	 *
	 * @param catalogName Catalog name
	 * @param schemaName Schema name
	 * @param volumeName Volume name
	 */
	async getVolume(
		catalogName: string,
		schemaName: string,
		volumeName: string,
	): Promise<Volume> {
		return await this.fetch(
			this.url(
				`catalogs/${catalogName}/schemas/${schemaName}/volumes/${volumeName}`,
			),
		);
	}

	/**
	 * Create a new volume
	 *
	 * @param request Volume creation request
	 */
	async createVolume(request: CreateVolumeRequest): Promise<Volume> {
		return await this.fetch(
			this.url(
				`catalogs/${request.catalog_name}/schemas/${request.schema_name}/volumes`,
			),
			{
				method: 'POST',
				body: JSON.stringify(request),
			},
		);
	}

	/**
	 * Update volume properties
	 *
	 * @param catalogName Catalog name
	 * @param schemaName Schema name
	 * @param volumeName Volume name
	 * @param updates Properties to update
	 */
	async updateVolume(
		catalogName: string,
		schemaName: string,
		volumeName: string,
		updates: Partial<Volume>,
	): Promise<Volume> {
		return await this.fetch(
			this.url(
				`catalogs/${catalogName}/schemas/${schemaName}/volumes/${volumeName}`,
			),
			{
				method: 'PATCH',
				body: JSON.stringify(updates),
			},
		);
	}

	/**
	 * Delete a volume
	 *
	 * @param catalogName Catalog name
	 * @param schemaName Schema name
	 * @param volumeName Volume name
	 */
	async deleteVolume(
		catalogName: string,
		schemaName: string,
		volumeName: string,
	): Promise<void> {
		await this.fetch(
			this.url(
				`catalogs/${catalogName}/schemas/${schemaName}/volumes/${volumeName}`,
			),
			{ method: 'DELETE' },
		);
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
	 * Get the name of the function that called fetch()
	 * This helps provide context in error messages
	 */
	private getCallerFunctionName(): string {
		try {
			// Create an error to get the stack trace
			const stack = new Error().stack;
			if (!stack) return 'perform operation';

			const lines = stack.split('\n');

			// We need to look for the caller of fetch, which should be 3 levels up
			// (error creation, getCallerFunctionName, fetch, actualCallingFunction)
			if (lines.length >= 4) {
				const callerLine = lines[3].trim();
				// Extract function name, typically format: "at functionName (...)"
				const match = callerLine.match(/at\s+([^(\s]+)/);
				if (match && match[1]) {
					return match[1].replace(/^[A-Z]/, (c) => c.toLowerCase());
				}
			}

			// If we can't determine the specific function, return a generic message
			return 'perform operation';
		} catch (_) {
			return 'perform operation';
		}
	}

	/**
	 * Fetch the given URL and parse the JSON response as T.
	 */
	private async fetch<T>(url: string, options: RequestInit = {}): Promise<T> {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), this.timeout);

		// Determine the calling function name for better error context
		const callerName = this.getCallerFunctionName();

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
			if (!response.ok) {
				// Create the error with the operation name but don't show a message yet
				const error = await UnityCatalogError.from(response, callerName);

				// Only show the error message from this point
				vscode.window.showErrorMessage(error.message);

				// Throw the error for upstream handling without showing another toast
				throw error;
			}
			if (response.status === 204) {
				// eslint-disable-next-line local/code-no-dangerous-type-assertions
				return {} as T;
			}
			return (await response.json()) as T;
		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError') {
				// Create a custom error message for timeouts
				const timeoutMessage = `Failed to ${callerName}: Request timed out after ${this.timeout}ms`;

				// Show only one toast message
				vscode.window.showErrorMessage(timeoutMessage);

				// Throw the error without generating another toast
				throw new Error(timeoutMessage);
			}

			// If it's not a UnityCatalogError or AbortError that we've already handled,
			// show a generic error message
			if (!(error instanceof UnityCatalogError)) {
				const errorMessage = `Failed to ${callerName}: ${error instanceof Error ? error.message : String(error)}`;
				throw new Error(errorMessage);
			}

			// For UnityCatalogError, we've already shown the toast, so just rethrow
			throw error;
		} finally {
			clearTimeout(timeoutId);
		}
	}
}

/**
 * Parse a full name into catalog, schema, and table parts
 *
 * @param fullName Full table or volume name (catalog.schema.name)
 * @returns Parsed namespaced identifier
 */
export function parseFullName(fullName: string): NamespacedIdentifier {
	const parts = fullName.split('.');
	if (parts.length !== 3) {
		throw new Error(
			`Invalid full name: ${fullName}. Expected format: catalog.schema.name`,
		);
	}
	return {
		catalog: parts[0],
		schema: parts[1],
		name: parts[2],
	};
}

/**
 * Format a namespaced identifier into a full name
 *
 * @param identifier Namespaced identifier
 * @returns Full name as catalog.schema.name
 */
export function formatFullName(identifier: NamespacedIdentifier): string {
	return `${identifier.catalog}.${identifier.schema}.${identifier.name}`;
}
