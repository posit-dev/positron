/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2025 Posit Software, PBC. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from 'sinon';
import {
	Catalog,
	Schema,
	Table,
	Volume,
} from '../../catalogs/unityCatalogClient';

/**
 * Helper constants for testing
 */
export const TEST_WORKSPACE = 'example.databricks.com';
export const TEST_TOKEN = 'test-token-123';

/**
 * Mock catalog data representing Databricks Unity Catalog catalogs
 */
export const mockCatalogs: Catalog[] = [
	{
		name: 'main',
		metastore_id: 'metastore1',
		comment: 'Main catalog',
		catalog_type: 'MANAGED',
	},
	{
		name: 'samples',
		metastore_id: 'metastore1',
		comment: 'Sample datasets',
		catalog_type: 'MANAGED',
	},
	{
		name: 'external',
		metastore_id: 'metastore1',
		comment: 'External data sources',
		catalog_type: 'EXTERNAL',
	},
];

/**
 * Mock schema data organized by catalog
 */
export const mockSchemas: Record<string, Schema[]> = {
	main: [
		{
			name: 'default',
			catalog_name: 'main',
			full_name: 'main.default',
			comment: 'Default schema',
		},
		{
			name: 'sales',
			catalog_name: 'main',
			full_name: 'main.sales',
			comment: 'Sales schema',
		},
		{
			name: 'marketing',
			catalog_name: 'main',
			full_name: 'main.marketing',
			comment: 'Marketing schema',
		},
	],
	samples: [
		{
			name: 'nyctaxi',
			catalog_name: 'samples',
			full_name: 'samples.nyctaxi',
			comment: 'NYC Taxi dataset',
		},
		{
			name: 'retail',
			catalog_name: 'samples',
			full_name: 'samples.retail',
			comment: 'Retail dataset',
		},
	],
	external: [
		{
			name: 's3data',
			catalog_name: 'external',
			full_name: 'external.s3data',
			comment: 'S3 external data',
		},
	],
};

/**
 * Mock table data organized by catalog and schema
 */
export const mockTables: Record<string, Record<string, Table[]>> = {
	main: {
		sales: [
			{
				name: 'customers',
				catalog_name: 'main',
				schema_name: 'sales',
				table_type: 'MANAGED',
				full_name: 'main.sales.customers',
				columns: [
					{
						name: 'id',
						type_text: 'INT',
						position: 0,
						nullable: false,
					},
					{
						name: 'name',
						type_text: 'STRING',
						position: 1,
						nullable: true,
					},
					{
						name: 'email',
						type_text: 'STRING',
						position: 2,
						nullable: true,
					},
				],
			},
			{
				name: 'orders',
				catalog_name: 'main',
				schema_name: 'sales',
				table_type: 'MANAGED',
				full_name: 'main.sales.orders',
				columns: [
					{
						name: 'id',
						type_text: 'INT',
						position: 0,
						nullable: false,
					},
					{
						name: 'customer_id',
						type_text: 'INT',
						position: 1,
						nullable: false,
					},
					{
						name: 'amount',
						type_text: 'DECIMAL(10,2)',
						position: 2,
						nullable: true,
					},
					{
						name: 'date',
						type_text: 'DATE',
						position: 3,
						nullable: true,
					},
				],
			},
		],
		marketing: [
			{
				name: 'campaigns',
				catalog_name: 'main',
				schema_name: 'marketing',
				table_type: 'MANAGED',
				full_name: 'main.marketing.campaigns',
				columns: [
					{
						name: 'id',
						type_text: 'INT',
						position: 0,
						nullable: false,
					},
					{
						name: 'name',
						type_text: 'STRING',
						position: 1,
						nullable: false,
					},
					{
						name: 'start_date',
						type_text: 'DATE',
						position: 2,
						nullable: false,
					},
					{
						name: 'end_date',
						type_text: 'DATE',
						position: 3,
						nullable: true,
					},
				],
			},
		],
	},
	samples: {
		nyctaxi: [
			{
				name: 'trips',
				catalog_name: 'samples',
				schema_name: 'nyctaxi',
				table_type: 'MANAGED',
				full_name: 'samples.nyctaxi.trips',
				columns: [
					{
						name: 'trip_id',
						type_text: 'STRING',
						position: 0,
						nullable: false,
					},
					{
						name: 'pickup_datetime',
						type_text: 'TIMESTAMP',
						position: 1,
						nullable: true,
					},
					{
						name: 'dropoff_datetime',
						type_text: 'TIMESTAMP',
						position: 2,
						nullable: true,
					},
					{
						name: 'passenger_count',
						type_text: 'INT',
						position: 3,
						nullable: true,
					},
					{
						name: 'trip_distance',
						type_text: 'DOUBLE',
						position: 4,
						nullable: true,
					},
				],
			},
		],
	},
};

/**
 * Mock volume data organized by catalog and schema
 */
export const mockVolumes: Record<string, Record<string, Volume[]>> = {
	main: {
		sales: [
			{
				name: 'data',
				catalog_name: 'main',
				schema_name: 'sales',
				volume_type: 'MANAGED',
				full_name: 'main.sales.data',
			},
			{
				name: 'reports',
				catalog_name: 'main',
				schema_name: 'sales',
				volume_type: 'MANAGED',
				full_name: 'main.sales.reports',
			},
		],
		marketing: [
			{
				name: 'assets',
				catalog_name: 'main',
				schema_name: 'marketing',
				volume_type: 'MANAGED',
				full_name: 'main.marketing.assets',
			},
		],
	},
	samples: {
		nyctaxi: [
			{
				name: 'raw',
				catalog_name: 'samples',
				schema_name: 'nyctaxi',
				volume_type: 'MANAGED',
				full_name: 'samples.nyctaxi.raw',
			},
		],
	},
};

/**
 * Mock directory content data
 */
export const mockVolumeContents: Record<string, any[]> = {
	'main.sales.data': [
		{
			name: 'customers.csv',
			path: '/Volumes/main/sales/data/customers.csv',
			is_directory: false,
			file_size: 1024,
			last_modified: Date.now() - 86400000, // 1 day ago
		},
		{
			name: 'orders.csv',
			path: '/Volumes/main/sales/data/orders.csv',
			is_directory: false,
			file_size: 2048,
			last_modified: Date.now() - 43200000, // 12 hours ago
		},
		{
			name: 'reports',
			path: '/Volumes/main/sales/data/reports',
			is_directory: true,
			file_size: 0,
			last_modified: Date.now() - 604800000, // 1 week ago
		},
	],
	'main.sales.data.reports': [
		{
			name: 'monthly.xlsx',
			path: '/Volumes/main/sales/data/reports/monthly.xlsx',
			is_directory: false,
			file_size: 4096,
			last_modified: Date.now() - 2592000000, // 30 days ago
		},
		{
			name: 'quarterly.xlsx',
			path: '/Volumes/main/sales/data/reports/quarterly.xlsx',
			is_directory: false,
			file_size: 8192,
			last_modified: Date.now() - 7776000000, // 90 days ago
		},
	],
	'main.marketing.assets': [
		{
			name: 'logo.png',
			path: '/Volumes/main/marketing/assets/logo.png',
			is_directory: false,
			file_size: 10240,
			last_modified: Date.now() - 15552000000, // 180 days ago
		},
		{
			name: 'images',
			path: '/Volumes/main/marketing/assets/images',
			is_directory: true,
			file_size: 0,
			last_modified: Date.now() - 2592000000, // 30 days ago
		},
	],
};

/**
 * Unity Catalog Mock class
 *
 * Provides utility methods for working with the mock data in tests
 */
export class UnityCatalogMock {
	/**
	 * Reference to the shared mock catalog data
	 */
	static readonly catalogs = mockCatalogs;

	/**
	 * Reference to the shared mock schema data
	 */
	static readonly schemas = mockSchemas;

	/**
	 * Reference to the shared mock table data
	 */
	static readonly tables = mockTables;

	/**
	 * Reference to the shared mock volume data
	 */
	static readonly volumes = mockVolumes;

	/**
	 * Reference to the shared mock volume contents data
	 */
	static readonly volumeContents = mockVolumeContents;
	/**
	 * Set up stubs for Unity Catalog API
	 * @param sandbox Sinon sandbox
	 * @returns The configured fetch stub for additional customization if needed
	 */
	static setupStubs(sandbox: sinon.SinonSandbox) {
		// Reset previous stubs to avoid conflicts
		sandbox.restore();

		// Create a new stub for fetch
		const fetchStub = sandbox.stub(global, 'fetch');

		// Catalogs
		fetchStub
			.withArgs(
				sinon.match((url: string | URL) => {
					const urlStr = url.toString();
					return urlStr.includes('/api/2.1/unity-catalog/catalogs');
				}),
			)
			.resolves({
				ok: true,
				status: 200,
				json: () => Promise.resolve({ catalogs: mockCatalogs }),
			} as Response);

		// Handle individual catalogs by name
		mockCatalogs.forEach((catalog) => {
			fetchStub
				.withArgs(
					sinon.match((url: string | URL) => {
						const urlStr = url.toString();
						return urlStr.includes(
							`/api/2.1/unity-catalog/catalogs/${catalog.name}`,
						);
					}),
				)
				.resolves({
					ok: true,
					status: 200,
					json: () => Promise.resolve(catalog),
				} as Response);
		});

		// Schemas
		Object.keys(mockSchemas).forEach((catalogName) => {
			// Use a flexible matcher that doesn't depend on exact parameter order
			fetchStub
				.withArgs(
					sinon.match((url: string | URL) => {
						const urlStr = url.toString();
						return (
							urlStr.includes('/api/2.1/unity-catalog/schemas') &&
							urlStr.includes(`catalog_name=${catalogName}`)
						);
					}),
				)
				.resolves({
					ok: true,
					status: 200,
					json: () =>
						Promise.resolve({
							schemas: mockSchemas[catalogName],
						}),
				} as Response);
		});

		// Tables
		Object.keys(mockTables).forEach((catalogName) => {
			Object.keys(mockTables[catalogName]).forEach((schemaName) => {
				fetchStub
					.withArgs(
						sinon.match((url: string | URL) => {
							const urlStr = url.toString();
							return (
								urlStr.includes('/api/2.1/unity-catalog/tables') &&
								urlStr.includes(`catalog_name=${catalogName}`) &&
								urlStr.includes(`schema_name=${schemaName}`)
							);
						}),
					)
					.resolves({
						ok: true,
						status: 200,
						json: () =>
							Promise.resolve({
								tables: mockTables[catalogName][schemaName],
							}),
					} as Response);
			});
		});

		// Volumes
		Object.keys(mockVolumes).forEach((catalogName) => {
			Object.keys(mockVolumes[catalogName]).forEach((schemaName) => {
				fetchStub
					.withArgs(
						sinon.match((url: string | URL) => {
							const urlStr = url.toString();
							return (
								urlStr.includes('/api/2.1/unity-catalog/volumes') &&
								urlStr.includes(`catalog_name=${catalogName}`) &&
								urlStr.includes(`schema_name=${schemaName}`)
							);
						}),
					)
					.resolves({
						ok: true,
						status: 200,
						json: () =>
							Promise.resolve({
								volumes: mockVolumes[catalogName][schemaName],
							}),
					} as Response);
			});
		});

		// Volume contents
		Object.keys(mockVolumeContents).forEach((volumePath) => {
			const sanitizedPath = volumePath.replace(/\./g, '/');
			fetchStub
				.withArgs(
					sinon.match((url: string | URL) => {
						const urlStr = url.toString();
						return urlStr.includes(
							`/api/2.0/fs/directories/Volumes/${sanitizedPath}`,
						);
					}),
				)
				.resolves({
					ok: true,
					status: 200,
					json: () =>
						Promise.resolve({
							contents: mockVolumeContents[volumePath],
						}),
				} as Response);
		});

		return fetchStub;
	}
}
