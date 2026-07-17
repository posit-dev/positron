/*---------------------------------------------------------------------------------------------
 *  Copyright (C) 2026 Posit Software, PBC. All rights reserved.
 *  Licensed under the Elastic License 2.0. See LICENSE.txt for license information.
 *--------------------------------------------------------------------------------------------*/

import { load } from 'js-yaml';

/**
 * The metadata for a single pin, parsed from the `data.txt` manifest that pins writes into every
 * pin bundle. The R and Python pins packages share this schema, so one parser serves both.
 *
 * See https://github.com/rstudio/pins-r (R/meta.R) and pins-python (pins/meta.py).
 */
export interface PinMeta {
	/** The data file (v1) or files that make up the pin. A bare string for single-file pins. */
	file: string | string[];

	/** The total size of the data file(s) in bytes, when recorded. */
	fileSize?: number;

	/** The xxhash64 of the data file(s), used by pins for cache invalidation. */
	pinHash?: string;

	/**
	 * The storage format of the pin: 'rds', 'csv', 'json', 'parquet', 'arrow', 'qs2', 'joblib', or
	 * 'file'. Drives the type badge in the tree and, later, which pins are previewable.
	 */
	type: string;

	/** The pin title. */
	title?: string;

	/** The pin description, or null when unset. */
	description?: string | null;

	/** User-supplied tags, or null when unset. */
	tags?: string[] | null;

	/** User-supplied URLs, or null when unset. */
	urls?: string[] | null;

	/** The pin creation timestamp, formatted as "YYYYMMDDTHHMMSSZ" (e.g. "20240115T093000Z"). */
	created?: string;

	/**
	 * The pins metadata version. Missing means legacy v0 (where `path` aliases `file`); v1 is the
	 * current version. A version greater than 1 is not understood by this driver.
	 */
	apiVersion: number;

	/** Arbitrary user metadata attached to the pin. Passed through untouched. */
	user?: unknown;
}

/** Coerces a YAML scalar to a finite number, or undefined when it is not numeric. */
function asNumber(value: unknown): number | undefined {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}
	if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
		return Number(value);
	}
	return undefined;
}

/** Coerces a YAML scalar to a non-empty string, or undefined otherwise. */
function asString(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Parses the YAML contents of a pin's `data.txt` manifest into a {@link PinMeta}.
 *
 * Legacy (v0) manifests aliased `path` to `file`, so a missing `file` falls back to `path`. A
 * manifest declaring a version newer than v1 is rejected, since its layout is not guaranteed to
 * match this schema.
 *
 * @param text The raw `data.txt` contents.
 * @returns The parsed metadata.
 * @throws If the text is not a YAML mapping, or declares an unsupported version.
 */
export function parsePinMeta(text: string): PinMeta {
	const raw = load(text);
	if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) {
		throw new Error('Invalid pin metadata: expected a YAML mapping');
	}
	const record = raw as Record<string, unknown>;

	// A missing api_version means a legacy v0 pin; anything past v1 is not understood here.
	const apiVersion = asNumber(record.api_version) ?? 0;
	if (apiVersion > 1) {
		throw new Error(`Unsupported pin metadata version: ${apiVersion}`);
	}

	// v0 stored the data file(s) under `path`; v1 renamed it to `file`.
	const fileValue = record.file ?? record.path;
	const file = Array.isArray(fileValue)
		? fileValue.map(String)
		: typeof fileValue === 'string'
			? fileValue
			: '';

	return {
		file,
		fileSize: asNumber(record.file_size),
		pinHash: asString(record.pin_hash),
		type: asString(record.type) ?? '',
		title: asString(record.title),
		description: record.description === null ? null : asString(record.description),
		tags: Array.isArray(record.tags) ? record.tags.map(String) : record.tags === null ? null : undefined,
		urls: Array.isArray(record.urls) ? record.urls.map(String) : record.urls === null ? null : undefined,
		created: asString(record.created),
		apiVersion,
		user: record.user,
	};
}
