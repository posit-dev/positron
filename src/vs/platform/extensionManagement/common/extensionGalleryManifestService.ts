/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../base/common/event.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { IProductService } from '../../product/common/productService.js';
import { ExtensionGalleryResourceType, Flag, IExtensionGalleryManifest, IExtensionGalleryManifestService, ExtensionGalleryManifestStatus } from './extensionGalleryManifest.js';
import { FilterType, SortBy } from './extensionManagement.js';

// --- Start Positron ---
export type ExtensionGalleryConfig = {
	// --- End Positron ---
	readonly serviceUrl: string;
	readonly itemUrl: string;
	readonly publisherUrl: string;
	readonly resourceUrlTemplate: string;
	readonly extensionUrlTemplate: string;
	readonly controlUrl: string;
	readonly nlsBaseUrl: string;
};

// --- Start Positron ---

/**
 * Base URLs for the built-in gallery presets. Every gallery (preset or custom)
 * is a single base URL run through deriveGalleryConfig, so the Open VSX URL
 * scheme lives in exactly one place and presets and custom URLs cannot drift.
 */
export const POSITRON_GALLERY_PRESET_BASES: Record<string, string> = {
	'posit-p3m': 'https://p3m.dev/openvsx/latest/vscode',
	'open-vsx': 'https://open-vsx.org/vscode',
};

/**
 * Derives a full gallery config from a base URL using the Open VSX URL scheme.
 * Returns undefined (and warns) when the base fails canonicalization, so a
 * malformed or unsafe value falls back to the product default rather than
 * producing broken or secret-bearing gallery URLs. A blank/whitespace-only
 * value returns undefined silently (it means "no custom URL", not an error).
 */
export function deriveGalleryConfig(
	base: string,
	warn: (message: string) => void = msg => console.warn(msg),
): ExtensionGalleryConfig | undefined {
	const trimmed = base.trim();
	if (!trimmed) {
		return undefined;
	}
	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		// Do not echo the raw value: a programmatic or settings.json value could
		// carry credentials past the settings-editor pattern.
		warn('Ignoring custom gallery URL: not a valid URL.');
		return undefined;
	}
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		warn('Ignoring custom gallery URL: must use http or https.');
		return undefined;
	}
	if (url.username || url.password || url.search || url.hash) {
		warn('Ignoring custom gallery URL: credentials, query, and fragment are not allowed.');
		return undefined;
	}
	// Canonical base: origin + pathname, trailing slashes stripped. By
	// construction this carries no credentials/query/fragment, so it is safe
	// to log and to show in notifications.
	const b = `${url.origin}${url.pathname}`.replace(/\/+$/, '');
	return {
		serviceUrl: `${b}/gallery`,
		itemUrl: `${b}/item`,
		resourceUrlTemplate: `${b}/asset/{publisher}/{name}/{version}/Microsoft.VisualStudio.Code.WebResources/{path}`,
		extensionUrlTemplate: `${b}/gallery/{publisher}/{name}/latest`,
		controlUrl: '',
		nlsBaseUrl: '',
		publisherUrl: '',
	};
}

/**
 * The built-in presets, derived from their base URLs. Kept as a named export
 * so existing consumers and tests continue to reference presets by config.
 */
export const POSITRON_GALLERY_PRESETS: Record<string, ExtensionGalleryConfig> =
	Object.fromEntries(
		Object.entries(POSITRON_GALLERY_PRESET_BASES).map(
			([name, base]) => [name, deriveGalleryConfig(base)!]
		)
	);

/**
 * Resolves the gallery config to use, applying the Positron precedence:
 * a successfully-parsed EXTENSIONS_GALLERY env var wins over the
 * `positron.extensions.gallerySource` setting, which wins over the default
 * product gallery. When gallerySource is 'custom', the config is derived from
 * customGalleryUrl, falling back to the product gallery when that URL is blank
 * or fails canonicalization. An env var that failed to parse should be passed
 * as undefined so the caller falls through to the preset/custom path.
 */
export function resolvePositronGalleryConfig(
	envGallery: ExtensionGalleryConfig | undefined,
	gallerySource: string | undefined,
	customGalleryUrl: string | undefined,
	productGallery: ExtensionGalleryConfig | undefined,
): ExtensionGalleryConfig | undefined {
	if (envGallery) {
		return envGallery;
	}
	if (gallerySource === 'custom') {
		return deriveGalleryConfig(customGalleryUrl ?? '') ?? productGallery;
	}
	const preset = gallerySource ? POSITRON_GALLERY_PRESETS[gallerySource] : undefined;
	return preset ?? productGallery;
}

// --- End Positron ---

export class ExtensionGalleryManifestService extends Disposable implements IExtensionGalleryManifestService {

	readonly _serviceBrand: undefined;
	readonly onDidChangeExtensionGalleryManifest = Event.None;
	readonly onDidChangeExtensionGalleryManifestStatus = Event.None;

	get extensionGalleryManifestStatus(): ExtensionGalleryManifestStatus {
		return !!this.productService.extensionsGallery?.serviceUrl ? ExtensionGalleryManifestStatus.Available : ExtensionGalleryManifestStatus.Unavailable;
	}

	constructor(
		@IProductService protected readonly productService: IProductService,
	) {
		super();
	}

	// --- Start Positron ---
	protected getGalleryConfig(): ExtensionGalleryConfig | undefined {
		return this.productService.extensionsGallery as ExtensionGalleryConfig | undefined;
	}
	// --- End Positron ---

	async getExtensionGalleryManifest(): Promise<IExtensionGalleryManifest | null> {
		// --- Start Positron ---
		const extensionsGallery = this.getGalleryConfig();
		// --- End Positron ---
		if (!extensionsGallery?.serviceUrl) {
			return null;
		}

		const resources = [
			{
				id: `${extensionsGallery.serviceUrl}/extensionquery`,
				type: ExtensionGalleryResourceType.ExtensionQueryService
			},
			{
				// --- Start PWB: Fix Open VSX URLs
				id: `${extensionsGallery.serviceUrl}/{publisher}/{name}/latest`,
				// --- End PWB: Fix Open VSX URLs
				type: ExtensionGalleryResourceType.ExtensionLatestVersionUri
			},
			{
				id: `${extensionsGallery.serviceUrl}/publishers/{publisher}/extensions/{name}/{version}/stats?statType={statTypeName}`,
				type: ExtensionGalleryResourceType.ExtensionStatisticsUri
			},
		];

		if (extensionsGallery.publisherUrl) {
			resources.push({
				id: `${extensionsGallery.publisherUrl}/{publisher}`,
				type: ExtensionGalleryResourceType.PublisherViewUri
			});
		}

		if (extensionsGallery.itemUrl) {
			resources.push({
				id: `${extensionsGallery.itemUrl}?itemName={publisher}.{name}`,
				type: ExtensionGalleryResourceType.ExtensionDetailsViewUri
			});
			resources.push({
				id: `${extensionsGallery.itemUrl}?itemName={publisher}.{name}&ssr=false#review-details`,
				type: ExtensionGalleryResourceType.ExtensionRatingViewUri
			});
		}

		if (extensionsGallery.resourceUrlTemplate) {
			resources.push({
				id: extensionsGallery.resourceUrlTemplate,
				type: ExtensionGalleryResourceType.ExtensionResourceUri
			});
		}

		const filtering = [
			{
				name: FilterType.Tag,
				value: 1,
			},
			{
				name: FilterType.ExtensionId,
				value: 4,
			},
			{
				name: FilterType.Category,
				value: 5,
			},
			{
				name: FilterType.ExtensionName,
				value: 7,
			},
			{
				name: FilterType.Target,
				value: 8,
			},
			{
				name: FilterType.Featured,
				value: 9,
			},
			{
				name: FilterType.SearchText,
				value: 10,
			},
			{
				name: FilterType.ExcludeWithFlags,
				value: 12,
			},
		];

		const sorting = [
			{
				name: SortBy.NoneOrRelevance,
				value: 0,
			},
			{
				name: SortBy.LastUpdatedDate,
				value: 1,
			},
			{
				name: SortBy.Title,
				value: 2,
			},
			{
				name: SortBy.PublisherName,
				value: 3,
			},
			{
				name: SortBy.InstallCount,
				value: 4,
			},
			{
				name: SortBy.AverageRating,
				value: 6,
			},
			{
				name: SortBy.PublishedDate,
				value: 10,
			},
			{
				name: SortBy.WeightedRating,
				value: 12,
			},
		];

		const flags = [
			{
				name: Flag.None,
				value: 0x0,
			},
			{
				name: Flag.IncludeVersions,
				value: 0x1,
			},
			{
				name: Flag.IncludeFiles,
				value: 0x2,
			},
			{
				name: Flag.IncludeCategoryAndTags,
				value: 0x4,
			},
			{
				name: Flag.IncludeSharedAccounts,
				value: 0x8,
			},
			{
				name: Flag.IncludeVersionProperties,
				value: 0x10,
			},
			{
				name: Flag.ExcludeNonValidated,
				value: 0x20,
			},
			{
				name: Flag.IncludeInstallationTargets,
				value: 0x40,
			},
			{
				name: Flag.IncludeAssetUri,
				value: 0x80,
			},
			{
				name: Flag.IncludeStatistics,
				value: 0x100,
			},
			{
				name: Flag.IncludeLatestVersionOnly,
				value: 0x200,
			},
			{
				name: Flag.Unpublished,
				value: 0x1000,
			},
			{
				name: Flag.IncludeNameConflictInfo,
				value: 0x8000,
			},
			{
				name: Flag.IncludeLatestPrereleaseAndStableVersionOnly,
				value: 0x10000,
			},
		];

		return {
			version: '',
			resources,
			capabilities: {
				extensionQuery: {
					filtering,
					sorting,
					flags,
				},
				signing: {
					allPublicRepositorySigned: true,
				}
			}
		};
	}
}
