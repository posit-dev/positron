import path from 'path';
import * as semver from 'semver';
import * as tar from 'tar';
import * as jsonc from 'jsonc-parser';
import * as crypto from 'crypto';

import { Log, LogLevel } from '../spec-utils/log';
import { isLocalFile, mkdirpLocal, readLocalFile, writeLocalFile } from '../spec-utils/pfs';
import { requestEnsureAuthenticated } from './httpOCIRegistry';
import { GoARCH, GoOS, PlatformInfo } from '../spec-common/commonUtils';

export const DEVCONTAINER_MANIFEST_MEDIATYPE = 'application/vnd.devcontainers';
export const DEVCONTAINER_TAR_LAYER_MEDIATYPE = 'application/vnd.devcontainers.layer.v1+tar';
export const DEVCONTAINER_COLLECTION_LAYER_MEDIATYPE = 'application/vnd.devcontainers.collection.layer.v1+json';


export interface CommonParams {
	env: NodeJS.ProcessEnv;
	output: Log;
	cachedAuthHeader?: Record<string, string>; // <registry, authHeader>
}

// Represents the unique OCI identifier for a Feature or Template.
// eg:  ghcr.io/devcontainers/features/go:1.0.0
// eg:  ghcr.io/devcontainers/features/go@sha256:fe73f123927bd9ed1abda190d3009c4d51d0e17499154423c5913cf344af15a3
// Constructed by 'getRef()'
export interface OCIRef {
	registry: string; 		// 'ghcr.io'
	owner: string;			// 'devcontainers'
	namespace: string;		// 'devcontainers/features'
	path: string;			// 'devcontainers/features/go'
	resource: string;		// 'ghcr.io/devcontainers/features/go'
	id: string;				// 'go'

	version: string;		// (Either the contents of 'tag' or 'digest')
	tag?: string;			// '1.0.0'
	digest?: string; 		// 'sha256:fe73f123927bd9ed1abda190d3009c4d51d0e17499154423c5913cf344af15a3'
}

// Represents the unique OCI identifier for a Collection's Metadata artifact.
// eg:  ghcr.io/devcontainers/features:latest
// Constructed by 'getCollectionRef()'
export interface OCICollectionRef {
	registry: string;		// 'ghcr.io'
	path: string;			// 'devcontainers/features'
	resource: string;		// 'ghcr.io/devcontainers/features'
	tag: 'latest';			// 'latest' (always)
	version: 'latest';		// 'latest' (always)
}

export interface OCILayer {
	mediaType: string;
	digest: string;
	size: number;
	annotations: {
		'org.opencontainers.image.title': string;
	};
}

export interface OCIManifest {
	digest?: string;
	schemaVersion: number;
	mediaType: string;
	config: {
		digest: string;
		mediaType: string;
		size: number;
	};
	layers: OCILayer[];
	annotations?: {
		'dev.containers.metadata'?: string;
		'com.github.package.type'?: string;
	};
}

export interface ManifestContainer {
	manifestObj: OCIManifest;
	manifestBuffer: Buffer;
	contentDigest: string;
	canonicalId: string;
}


interface OCITagList {
	name: string;
	tags: string[];
}

interface OCIImageIndexEntry {
	mediaType: string;
	size: number;
	digest: string;
	platform: {
		architecture: string;
		variant?: string;
		os: string;
	};
}

// https://github.com/opencontainers/image-spec/blob/main/manifest.md#example-image-manifest
interface OCIImageIndex {
	schemaVersion: number;
	mediaType: string;
	manifests: OCIImageIndexEntry[];
}

// Following Spec:   https://github.com/opencontainers/distribution-spec/blob/main/spec.md#pulling-manifests
// Alternative Spec: https://docs.docker.com/registry/spec/api/#overview
//
// The path:
// 'namespace' in spec terminology for the given repository
// (eg: devcontainers/features/go)
const regexForPath = /^[a-z0-9]+([._-][a-z0-9]+)*(\/[a-z0-9]+([._-][a-z0-9]+)*)*$/;
// The reference:
// MUST be either (a) the digest of the manifest or (b) a tag
// MUST be at most 128 characters in length and MUST match the following regular expression:
const regexForVersionOrDigest = /^[a-zA-Z0-9_][a-zA-Z0-9._-]{0,127}$/;

// https://go.dev/doc/install/source#environment
// Expected by OCI Spec as seen here: https://github.com/opencontainers/image-spec/blob/main/image-index.md#image-index-property-descriptions
export function mapNodeArchitectureToGOARCH(arch: NodeJS.Architecture): GoARCH {
	switch (arch) {
		case 'x64':
			return 'amd64';
		default:
			return arch;
	}
}

// https://go.dev/doc/install/source#environment
// Expected by OCI Spec as seen here: https://github.com/opencontainers/image-spec/blob/main/image-index.md#image-index-property-descriptions
export function mapNodeOSToGOOS(os: NodeJS.Platform): GoOS {
	switch (os) {
		case 'win32':
			return 'windows';
		default:
			return os;
	}
}

// https://github.com/opencontainers/distribution-spec/blob/main/spec.md#pulling-manifests
// Attempts to parse the given string into an OCIRef
export function getRef(output: Log, input: string): OCIRef | undefined {
	// Normalize input by downcasing entire string
	input = input.toLowerCase();

	// Invalid if first character is a dot
	if (input.startsWith('.')) {
		output.write(`Input '${input}' failed validation.  Expected input to not start with '.'`, LogLevel.Error);
		return;
	}

	const indexOfLastColon = input.lastIndexOf(':');
	const indexOfLastAtCharacter = input.lastIndexOf('@');

	let resource = '';
	let tag: string | undefined = undefined;
	let digest: string | undefined = undefined;

	// -- Resolve version
	if (indexOfLastAtCharacter !== -1) {
		// The version is specified by digest
		// eg: ghcr.io/codspace/features/ruby@sha256:abcdefgh
		resource = input.substring(0, indexOfLastAtCharacter);
		const digestWithHashingAlgorithm = input.substring(indexOfLastAtCharacter + 1);
		const splitOnColon = digestWithHashingAlgorithm.split(':');
		if (splitOnColon.length !== 2) {
			output.write(`Failed to parse digest '${digestWithHashingAlgorithm}'.   Expected format: 'sha256:abcdefghijk'`, LogLevel.Error);
			return;
		}

		if (splitOnColon[0] !== 'sha256') {
			output.write(`Digest algorithm for input '${input}' failed validation.  Expected hashing algorithm to be 'sha256'.`, LogLevel.Error);
			return;
		}

		if (!regexForVersionOrDigest.test(splitOnColon[1])) {
			output.write(`Digest for input '${input}' failed validation.  Expected digest to match regex '${regexForVersionOrDigest}'.`, LogLevel.Error);
		}

		digest = digestWithHashingAlgorithm;
	} else if (indexOfLastColon !== -1 && indexOfLastColon > input.lastIndexOf('/')) {
		// The version is specified by tag
		// eg: ghcr.io/codspace/features/ruby:1.0.0

		//  1. The last colon is before the first slash (a port)
		//     eg:   ghcr.io:8081/codspace/features/ruby
		//  2. There is no tag at all
		//     eg:   ghcr.io/codspace/features/ruby
		resource = input.substring(0, indexOfLastColon);
		tag = input.substring(indexOfLastColon + 1);
	} else {
		// There is no tag or digest, so assume 'latest'
		resource = input;
		tag = 'latest';
	}


	if (tag && !regexForVersionOrDigest.test(tag)) {
		output.write(`Tag '${tag}' for input '${input}' failed validation.  Expected digest to match regex '${regexForVersionOrDigest}'.`, LogLevel.Error);
		return;
	}

	const splitOnSlash = resource.split('/');

	if (splitOnSlash[1] === 'devcontainers-contrib') {
		output.write(`Redirecting 'devcontainers-contrib' to 'devcontainers-extra'.`);
		splitOnSlash[1] = 'devcontainers-extra';
	}

	const id = splitOnSlash[splitOnSlash.length - 1]; // Aka 'featureName' - Eg: 'ruby'
	const owner = splitOnSlash[1];
	const registry = splitOnSlash[0];
	const namespace = splitOnSlash.slice(1, -1).join('/');

	const path = `${namespace}/${id}`;

	if (!regexForPath.exec(path)) {
		output.write(`Path '${path}' for input '${input}' failed validation.  Expected path to match regex '${regexForPath}'.`, LogLevel.Error);
		return;
	}

	const version = digest || tag || 'latest'; // The most specific version.

	output.write(`> input: ${input}`, LogLevel.Trace);
	output.write(`>`, LogLevel.Trace);
	output.write(`> resource: ${resource}`, LogLevel.Trace);
	output.write(`> id: ${id}`, LogLevel.Trace);
	output.write(`> owner: ${owner}`, LogLevel.Trace);
	output.write(`> namespace: ${namespace}`, LogLevel.Trace); // TODO: We assume 'namespace' includes at least one slash (eg: 'devcontainers/features')
	output.write(`> registry: ${registry}`, LogLevel.Trace);
	output.write(`> path: ${path}`, LogLevel.Trace);
	output.write(`>`, LogLevel.Trace);
	output.write(`> version: ${version}`, LogLevel.Trace);
	output.write(`> tag?: ${tag}`, LogLevel.Trace);
	output.write(`> digest?: ${digest}`, LogLevel.Trace);

	return {
		id,
		owner,
		namespace,
		registry,
		resource,
		path,
		version,
		tag,
		digest,
	};
}

export function getCollectionRef(output: Log, registry: string, namespace: string): OCICollectionRef | undefined {
	// Normalize input by downcasing entire string
	registry = registry.toLowerCase();
	namespace = namespace.toLowerCase();

	const path = namespace;
	const resource = `${registry}/${path}`;

	output.write(`> Inputs: registry='${registry}' namespace='${namespace}'`, LogLevel.Trace);
	output.write(`>`, LogLevel.Trace);
	output.write(`> resource: ${resource}`, LogLevel.Trace);

	if (!regexForPath.exec(path)) {
		output.write(`Parsed path '${path}' from input failed validation.`, LogLevel.Error);
		return undefined;
	}

	return {
		registry,
		path,
		resource,
		version: 'latest',
		tag: 'latest',
	};
}

// Validate if a manifest exists and is reachable about the declared feature/template.
// Specification: https://github.com/opencontainers/distribution-spec/blob/v1.0.1/spec.md#pulling-manifests
export async function fetchOCIManifestIfExists(params: CommonParams, ref: OCIRef | OCICollectionRef, manifestDigest?: string): Promise<ManifestContainer | undefined> {
	const { output } = params;

	// Simple mechanism to avoid making a DNS request for
	// something that is not a domain name.
	if (ref.registry.indexOf('.') < 0 && !ref.registry.startsWith('localhost')) {
		return;
	}

	// TODO: Always use the manifest digest (the canonical digest)
	//       instead of the `ref.version` by referencing some lock file (if available).
	let reference = ref.version;
	if (manifestDigest) {
		reference = manifestDigest;
	}
	const manifestUrl = `https://${ref.registry}/v2/${ref.path}/manifests/${reference}`;
	output.write(`manifest url: ${manifestUrl}`, LogLevel.Trace);
	const expectedDigest = manifestDigest || ('digest' in ref ? ref.digest : undefined);
	const manifestContainer = await getManifest(params, manifestUrl, ref, undefined, expectedDigest);

	if (!manifestContainer || !manifestContainer.manifestObj) {
		return;
	}

	const { manifestObj } = manifestContainer;

	if (manifestObj.config.mediaType !== DEVCONTAINER_MANIFEST_MEDIATYPE) {
		output.write(`(!) Unexpected manifest media type: ${manifestObj.config.mediaType}`, LogLevel.Error);
		return undefined;
	}

	return manifestContainer;
}

export async function getManifest(params: CommonParams, url: string, ref: OCIRef | OCICollectionRef, mimeType?: string, expectedDigest?: string): Promise<ManifestContainer | undefined> {
	const { output } = params;
	const res = await getBufferWithMimeType(params, url, ref, mimeType || 'application/vnd.oci.image.manifest.v1+json');
	if (!res) {
		return undefined;
	}

	const { body, headers } = res;

	// Per the specification:
	// https://github.com/opencontainers/distribution-spec/blob/v1.0.1/spec.md#pulling-manifests
	// The registry server SHOULD return the canonical content digest in a header, but it's not required to.
	// That is useful to have, so if the server doesn't provide it, recalculate it outselves.
	// Headers are always automatically downcased by node.
	let contentDigest = headers['docker-content-digest'];
	if (!contentDigest || expectedDigest) {
		if (!contentDigest) {
			output.write('Registry did not send a \'docker-content-digest\' header.  Recalculating...', LogLevel.Trace);
		}
		contentDigest = `sha256:${crypto.createHash('sha256').update(body).digest('hex')}`;
	}

	if (expectedDigest && contentDigest !== expectedDigest) {
		throw new Error(`Digest did not match for ${ref.resource}.`);
	}

	return {
		contentDigest,
		manifestObj: JSON.parse(body.toString()),
		manifestBuffer: body,
		canonicalId: `${ref.resource}@${contentDigest}`,
	};
}

// https://github.com/opencontainers/image-spec/blob/main/manifest.md
export async function getImageIndexEntryForPlatform(params: CommonParams, url: string, ref: OCIRef | OCICollectionRef, platformInfo: PlatformInfo, mimeType?: string): Promise<OCIImageIndexEntry | undefined> {
	const { output } = params;
	const response = await getJsonWithMimeType<OCIImageIndex>(params, url, ref, mimeType || 'application/vnd.oci.image.index.v1+json');
	if (!response) {
		return undefined;
	}

	const { body: imageIndex } = response;
	if (!imageIndex) {
		output.write(`Unwrapped response for image index is undefined.`, LogLevel.Error);
		return undefined;
	}

	// Find a manifest for the current architecture and OS.
	return imageIndex.manifests.find(m => {
		if (m.platform?.architecture === platformInfo.arch && m.platform?.os === platformInfo.os) {
			if (!platformInfo.variant || m.platform?.variant === platformInfo.variant) {
				return m;
			}
		}
		return undefined;
	});
}

async function getBufferWithMimeType(params: CommonParams, url: string, ref: OCIRef | OCICollectionRef, mimeType: string): Promise<{ body: Buffer; headers: Record<string, string> } | undefined> {
	const { output } = params;
	const headers = {
		'user-agent': 'devcontainer',
		'accept': mimeType,
	};

	const httpOptions = {
		type: 'GET',
		url: url,
		headers: headers
	};

	const res = await requestEnsureAuthenticated(params, httpOptions, ref);
	if (!res) {
		output.write(`Request '${url}' failed`, LogLevel.Error);
		return;
	}

	// NOTE: A 404 is expected here if the manifest does not exist on the remote.
	if (res.statusCode > 299) {
		// Get the error out.
		const errorMsg = res?.resBody?.toString();
		output.write(`Did not fetch target with expected mimetype '${mimeType}': ${errorMsg}`, LogLevel.Trace);
		return;
	}

	return {
		body: res.resBody,
		headers: res.resHeaders,
	};
}

async function getJsonWithMimeType<T>(params: CommonParams, url: string, ref: OCIRef | OCICollectionRef, mimeType: string): Promise<{ body: T; headers: Record<string, string> } | undefined> {
	const { output } = params;
	let body: string = '';
	try {
		const headers = {
			'user-agent': 'devcontainer',
			'accept': mimeType,
		};

		const httpOptions = {
			type: 'GET',
			url: url,
			headers: headers
		};

		const res = await requestEnsureAuthenticated(params, httpOptions, ref);
		if (!res) {
			output.write(`Request '${url}' failed`, LogLevel.Error);
			return;
		}

		const { resBody, statusCode, resHeaders } = res;
		body = resBody.toString();

		// NOTE: A 404 is expected here if the manifest does not exist on the remote.
		if (statusCode > 299) {
			output.write(`Did not fetch target with expected mimetype '${mimeType}': ${body}`, LogLevel.Trace);
			return;
		}
		const parsedBody: T = JSON.parse(body);
		output.write(`Fetched: ${JSON.stringify(parsedBody, undefined, 4)}`, LogLevel.Trace);
		return {
			body: parsedBody,
			headers: resHeaders,
		};
	} catch (e) {
		output.write(`Failed to parse JSON with mimeType '${mimeType}': ${body}`, LogLevel.Error);
		return;
	}
}

// Gets published tags and sorts them by ascending semantic version.
// Omits any tags (eg: 'latest', or major/minor tags '1','1.0') that are not semantic versions.
export async function getVersionsStrictSorted(params: CommonParams, ref: OCIRef): Promise<string[] | undefined> {
	const { output } = params;

	const publishedTags = await getPublishedTags(params, ref);
	if (!publishedTags) {
		return;
	}

	const sortedVersions = publishedTags
		.filter(f => semver.valid(f)) // Remove all major,minor,latest tags
		.sort((a, b) => semver.compare(a, b));

	output.write(`Published versions (sorted) for '${ref.id}': ${JSON.stringify(sortedVersions, undefined, 2)}`, LogLevel.Trace);

	return sortedVersions;
}

// Lists published tags of a Feature/Template
// Specification: https://github.com/opencontainers/distribution-spec/blob/v1.0.1/spec.md#content-discovery
export async function getPublishedTags(params: CommonParams, ref: OCIRef): Promise<string[] | undefined> {
	const { output } = params;
	try {
		const url = `https://${ref.registry}/v2/${ref.namespace}/${ref.id}/tags/list`;

		const headers = {
			'Accept': 'application/json',
		};

		const httpOptions = {
			type: 'GET',
			url: url,
			headers: headers
		};

		const res = await requestEnsureAuthenticated(params, httpOptions, ref);
		if (!res) {
			output.write('Request failed', LogLevel.Error);
			return;
		}

		const { statusCode, resBody } = res;
		const body = resBody.toString();

		// Expected when publishing for the first time
		if (statusCode === 404) {
			return [];
			// Unexpected Error
		} else if (statusCode > 299) {
			output.write(`(!) ERR: Could not fetch published tags for '${ref.namespace}/${ref.id}' : ${resBody ?? ''} `, LogLevel.Error);
			return;
		}

		const publishedVersionsResponse: OCITagList = JSON.parse(body);

		// Return published tags from the registry as-is, meaning:
		// - Not necessarily sorted
		// - *Including* major/minor/latest tags
		return publishedVersionsResponse.tags;
	} catch (e) {
		output.write(`Failed to parse published versions: ${e}`, LogLevel.Error);
		return;
	}
}

export async function getBlob(params: CommonParams, url: string, ociCacheDir: string, destCachePath: string, ociRef: OCIRef, expectedDigest: string, omitDuringExtraction: string[] = [], metadataFile?: string): Promise<{ files: string[]; metadata: {} | undefined } | undefined> {
	// TODO: Parallelize if multiple layers (not likely).
	// TODO: Seeking might be needed if the size is too large.

	const { output } = params;
	try {
		await mkdirpLocal(ociCacheDir);
		const tempTarballPath = path.join(ociCacheDir, 'blob.tar');

		const headers = {
			'Accept': 'application/vnd.oci.image.manifest.v1+json',
		};

		const httpOptions = {
			type: 'GET',
			url: url,
			headers: headers
		};

		const res = await requestEnsureAuthenticated(params, httpOptions, ociRef);
		if (!res) {
			output.write('Request failed', LogLevel.Error);
			return;
		}

		const { statusCode, resBody } = res;
		if (statusCode > 299) {
			output.write(`Failed to fetch blob (${url}): ${resBody}`, LogLevel.Error);
			return;
		}

		const actualDigest = `sha256:${crypto.createHash('sha256').update(resBody).digest('hex')}`;
		if (actualDigest !== expectedDigest) {
			throw new Error(`Digest did not match for ${ociRef.resource}.`);
		}

		await mkdirpLocal(destCachePath);
		await writeLocalFile(tempTarballPath, resBody);

		// https://github.com/devcontainers/spec/blob/main/docs/specs/devcontainer-templates.md#the-optionalpaths-property
		const directoriesToOmit = omitDuringExtraction.filter(f => f.endsWith('/*')).map(f => f.slice(0, -1));
		const filesToOmit = omitDuringExtraction.filter(f => !f.endsWith('/*'));
		
		output.write(`omitDuringExtraction: '${omitDuringExtraction.join(', ')}`, LogLevel.Trace);
		output.write(`Files to omit: '${filesToOmit.join(', ')}'`, LogLevel.Info);
		if (directoriesToOmit.length) {
			output.write(`Dirs to omit : '${directoriesToOmit.join(', ')}'`, LogLevel.Info);
		}

		const files: string[] = [];
		await tar.x(
			{
				file: tempTarballPath,
				cwd: destCachePath,
				filter: (tPath: string, stat: tar.FileStat) => {
					output.write(`Testing '${tPath}'(${stat.type})`, LogLevel.Trace);
					const cleanedPath = tPath
						.replace(/\\/g, '/')
						.replace(/^\.\//, '');

					if (filesToOmit.includes(cleanedPath) || directoriesToOmit.some(d => cleanedPath.startsWith(d))) {
						output.write(`  Omitting '${tPath}'`, LogLevel.Trace);
						return false; // Skip
					}

					if (stat.type.toString() === 'File') {
						files.push(tPath);
					}

					return true; // Keep
				}
			}
		);
		output.write('Files extracted from blob: ' + files.join(', '), LogLevel.Trace);

		// No 'metadataFile' to look for.
		if (!metadataFile) {
			return { files, metadata: undefined };
		}

		// Attempt to extract 'metadataFile'
		await tar.x(
			{
				file: tempTarballPath,
				cwd: ociCacheDir,
				filter: (tPath: string, _: tar.FileStat) => {
					return tPath === `./${metadataFile}`;
				}
			});
		const pathToMetadataFile = path.join(ociCacheDir, metadataFile);
		let metadata = undefined;
		if (await isLocalFile(pathToMetadataFile)) {
			output.write(`Found metadata file '${metadataFile}' in blob`, LogLevel.Trace);
			metadata = jsonc.parse((await readLocalFile(pathToMetadataFile)).toString());
		}

		return {
			files, metadata
		};
	} catch (e) {
		output.write(`Error getting blob: ${e}`, LogLevel.Error);
		return;
	}
}
