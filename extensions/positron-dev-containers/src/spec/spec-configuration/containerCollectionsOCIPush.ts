import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { delay } from '../spec-common/async';
import { Log, LogLevel } from '../spec-utils/log';
import { isLocalFile } from '../spec-utils/pfs';
import { DEVCONTAINER_COLLECTION_LAYER_MEDIATYPE, DEVCONTAINER_TAR_LAYER_MEDIATYPE, fetchOCIManifestIfExists, OCICollectionRef, OCILayer, OCIManifest, OCIRef, CommonParams, ManifestContainer } from './containerCollectionsOCI';
import { requestEnsureAuthenticated } from './httpOCIRegistry';

// (!) Entrypoint function to push a single feature/template to a registry.
//     Devcontainer Spec (features) : https://containers.dev/implementors/features-distribution/#oci-registry
//     Devcontainer Spec (templates): https://github.com/devcontainers/spec/blob/main/proposals/devcontainer-templates-distribution.md#oci-registry
//     OCI Spec                     : https://github.com/opencontainers/distribution-spec/blob/main/spec.md#push
export async function pushOCIFeatureOrTemplate(params: CommonParams, ociRef: OCIRef, pathToTgz: string, tags: string[], collectionType: string, annotations: { [key: string]: string } = {}): Promise<string | undefined> {
	const { output } = params;

	output.write(`-- Starting push of ${collectionType} '${ociRef.id}' to '${ociRef.resource}' with tags '${tags.join(', ')}'`);
	output.write(`${JSON.stringify(ociRef, null, 2)}`, LogLevel.Trace);

	if (!(await isLocalFile(pathToTgz))) {
		output.write(`Blob ${pathToTgz} does not exist.`, LogLevel.Error);
		return;
	}

	const dataBytes = fs.readFileSync(pathToTgz);

	// Generate Manifest for given feature/template artifact.
	const manifest = await generateCompleteManifestForIndividualFeatureOrTemplate(output, dataBytes, pathToTgz, ociRef, collectionType, annotations);
	if (!manifest) {
		output.write(`Failed to generate manifest for ${ociRef.id}`, LogLevel.Error);
		return;
	}

	output.write(`Generated manifest: \n${JSON.stringify(manifest?.manifestObj, undefined, 4)}`, LogLevel.Trace);

	// If the exact manifest digest already exists in the registry, we don't need to push individual blobs (it's already there!) 
	const existingManifest = await fetchOCIManifestIfExists(params, ociRef, manifest.contentDigest);
	if (manifest.contentDigest && existingManifest) {
		output.write(`Not reuploading blobs, digest already exists.`, LogLevel.Trace);
		return await putManifestWithTags(params, manifest, ociRef, tags);
	}

	const blobsToPush = [
		{
			name: 'configLayer',
			digest: manifest.manifestObj.config.digest,
			size: manifest.manifestObj.config.size,
			contents: Buffer.from('{}'),
		},
		{
			name: 'tgzLayer',
			digest: manifest.manifestObj.layers[0].digest,
			size: manifest.manifestObj.layers[0].size,
			contents: dataBytes,
		}
	];


	for await (const blob of blobsToPush) {
		const { name, digest } = blob;
		const blobExistsConfigLayer = await checkIfBlobExists(params, ociRef, digest);
		output.write(`blob: '${name}'  ${blobExistsConfigLayer ? 'DOES exists' : 'DOES NOT exist'} in registry.`, LogLevel.Trace);

		// PUT blobs
		if (!blobExistsConfigLayer) {

			// Obtain session ID with `/v2/<namespace>/blobs/uploads/` 
			const blobPutLocationUriPath = await postUploadSessionId(params, ociRef);
			if (!blobPutLocationUriPath) {
				output.write(`Failed to get upload session ID`, LogLevel.Error);
				return;
			}

			if (!(await putBlob(params, blobPutLocationUriPath, ociRef, blob))) {
				output.write(`Failed to PUT blob '${name}' with digest '${digest}'`, LogLevel.Error);
				return;
			}
		}
	}

	// Send a final PUT to combine blobs and tag manifest properly.
	return await putManifestWithTags(params, manifest, ociRef, tags);
}

// (!) Entrypoint function to push a collection metadata/overview file for a set of features/templates to a registry.
//     Devcontainer Spec (features) : https://containers.dev/implementors/features-distribution/#oci-registry (see 'devcontainer-collection.json')
// 	   Devcontainer Spec (templates): https://github.com/devcontainers/spec/blob/main/proposals/devcontainer-templates-distribution.md#oci-registry  (see 'devcontainer-collection.json')
//     OCI Spec                     : https://github.com/opencontainers/distribution-spec/blob/main/spec.md#push
export async function pushCollectionMetadata(params: CommonParams, collectionRef: OCICollectionRef, pathToCollectionJson: string, collectionType: string): Promise<string | undefined> {
	const { output } = params;

	output.write(`Starting push of latest ${collectionType} collection for namespace '${collectionRef.path}' to '${collectionRef.registry}'`);
	output.write(`${JSON.stringify(collectionRef, null, 2)}`, LogLevel.Trace);

	if (!(await isLocalFile(pathToCollectionJson))) {
		output.write(`Collection Metadata was not found at expected location: ${pathToCollectionJson}`, LogLevel.Error);
		return;
	}

	const dataBytes = fs.readFileSync(pathToCollectionJson);

	// Generate Manifest for collection artifact.
	const manifest = await generateCompleteManifestForCollectionFile(output, dataBytes, collectionRef);
	if (!manifest) {
		output.write(`Failed to generate manifest for ${collectionRef.path}`, LogLevel.Error);
		return;
	}
	output.write(`Generated manifest: \n${JSON.stringify(manifest?.manifestObj, undefined, 4)}`, LogLevel.Trace);

	// If the exact manifest digest already exists in the registry, we don't need to push individual blobs (it's already there!) 
	const existingManifest = await fetchOCIManifestIfExists(params, collectionRef, manifest.contentDigest);
	if (manifest.contentDigest && existingManifest) {
		output.write(`Not reuploading blobs, digest already exists.`, LogLevel.Trace);
		return await putManifestWithTags(params, manifest, collectionRef, ['latest']);
	}

	const blobsToPush = [
		{
			name: 'configLayer',
			digest: manifest.manifestObj.config.digest,
			size: manifest.manifestObj.config.size,
			contents: Buffer.from('{}'),
		},
		{
			name: 'collectionLayer',
			digest: manifest.manifestObj.layers[0].digest,
			size: manifest.manifestObj.layers[0].size,
			contents: dataBytes,
		}
	];

	for await (const blob of blobsToPush) {
		const { name, digest } = blob;
		const blobExistsConfigLayer = await checkIfBlobExists(params, collectionRef, digest);
		output.write(`blob: '${name}' with digest '${digest}'  ${blobExistsConfigLayer ? 'already exists' : 'does not exist'} in registry.`, LogLevel.Trace);

		// PUT blobs
		if (!blobExistsConfigLayer) {

			// Obtain session ID with `/v2/<namespace>/blobs/uploads/` 
			const blobPutLocationUriPath = await postUploadSessionId(params, collectionRef);
			if (!blobPutLocationUriPath) {
				output.write(`Failed to get upload session ID`, LogLevel.Error);
				return;
			}

			if (!(await putBlob(params, blobPutLocationUriPath, collectionRef, blob))) {
				output.write(`Failed to PUT blob '${name}' with digest '${digest}'`, LogLevel.Error);
				return;
			}
		}
	}

	// Send a final PUT to combine blobs and tag manifest properly.
	// Collections are always tagged 'latest'
	return await putManifestWithTags(params, manifest, collectionRef, ['latest']);
}

// --- Helper Functions

// Spec: https://github.com/opencontainers/distribution-spec/blob/main/spec.md#pushing-manifests (PUT /manifests/<ref>)
async function putManifestWithTags(params: CommonParams, manifest: ManifestContainer, ociRef: OCIRef | OCICollectionRef, tags: string[]): Promise<string | undefined> {
	const { output } = params;

	output.write(`Tagging manifest with tags: ${tags.join(', ')}`, LogLevel.Trace);

	const { manifestBuffer, contentDigest } = manifest;

	for await (const tag of tags) {
		const url = `https://${ociRef.registry}/v2/${ociRef.path}/manifests/${tag}`;
		output.write(`PUT -> '${url}'`, LogLevel.Trace);

		const httpOptions = {
			type: 'PUT',
			url,
			headers: {
				'content-type': 'application/vnd.oci.image.manifest.v1+json',
			},
			data: manifestBuffer,
		};

		let res = await requestEnsureAuthenticated(params, httpOptions, ociRef);
		if (!res) {
			output.write('Request failed', LogLevel.Error);
			return;
		}

		// Retry logic: when request fails with HTTP 429: too many requests
		// TODO: Wrap into `requestEnsureAuthenticated`?
		if (res.statusCode === 429) {
			output.write(`Failed to PUT manifest for tag ${tag} due to too many requests. Retrying...`, LogLevel.Warning);
			await delay(2000);

			res = await requestEnsureAuthenticated(params, httpOptions, ociRef);
			if (!res) {
				output.write('Request failed', LogLevel.Error);
				return;
			}
		}

		const { statusCode, resBody, resHeaders } = res;

		if (statusCode !== 201) {
			const parsed = JSON.parse(resBody?.toString() || '{}');
			output.write(`Failed to PUT manifest for tag ${tag}\n${JSON.stringify(parsed, undefined, 4)}`, LogLevel.Error);
			return;
		}

		const dockerContentDigestResponseHeader = resHeaders['docker-content-digest'];
		const locationResponseHeader = resHeaders['location'] || resHeaders['Location'];
		output.write(`Tagged: ${tag} -> ${locationResponseHeader}`, LogLevel.Info);
		output.write(`Returned Content-Digest: ${dockerContentDigestResponseHeader}`, LogLevel.Trace);
	}
	return contentDigest;
}

// Spec: https://github.com/opencontainers/distribution-spec/blob/main/spec.md#post-then-put (PUT <location>?digest=<digest>)
async function putBlob(params: CommonParams, blobPutLocationUriPath: string, ociRef: OCIRef | OCICollectionRef, blob: { name: string; digest: string; size: number; contents: Buffer }): Promise<boolean> {

	const { output } = params;
	const { name, digest, size, contents } = blob;

	output.write(`Starting PUT of ${name} blob '${digest}' (size=${size})`, LogLevel.Info);

	const headers = {
		'content-type': 'application/octet-stream',
		'content-length': `${size}`
	};

	// OCI distribution spec is ambiguous on whether we get back an absolute or relative path.
	let url = '';
	if (blobPutLocationUriPath.startsWith('https://') || blobPutLocationUriPath.startsWith('http://')) {
		url = blobPutLocationUriPath;
	} else {
		url = `https://${ociRef.registry}${blobPutLocationUriPath}`;
	}

	// The <location> MAY contain critical query parameters.
	//  Additionally, it SHOULD match exactly the <location> obtained from the POST request.
	// It SHOULD NOT be assembled manually by clients except where absolute/relative conversion is necessary.
	const queryParamsStart = url.indexOf('?');
	if (queryParamsStart === -1) {
		// Just append digest to the end.
		url += `?digest=${digest}`;
	} else {
		url = url.substring(0, queryParamsStart) + `?digest=${digest}` + '&' + url.substring(queryParamsStart + 1);
	}

	output.write(`PUT blob to ->  ${url}`, LogLevel.Trace);

	const res = await requestEnsureAuthenticated(params, { type: 'PUT', url, headers, data: contents }, ociRef);
	if (!res) {
		output.write('Request failed', LogLevel.Error);
		return false;
	}

	const { statusCode, resBody } = res;

	if (statusCode !== 201) {
		const parsed = JSON.parse(resBody?.toString() || '{}');
		output.write(`${statusCode}: Failed to upload blob '${digest}' to '${url}' \n${JSON.stringify(parsed, undefined, 4)}`, LogLevel.Error);
		return false;
	}

	return true;
}

// Generate a layer that follows the `application/vnd.devcontainers.layer.v1+tar` mediaType as defined in
//     Devcontainer Spec (features) : https://containers.dev/implementors/features-distribution/#oci-registry
//     Devcontainer Spec (templates): https://github.com/devcontainers/spec/blob/main/proposals/devcontainer-templates-distribution.md#oci-registry
async function generateCompleteManifestForIndividualFeatureOrTemplate(output: Log, dataBytes: Buffer, pathToTgz: string, ociRef: OCIRef, collectionType: string, annotations: { [key: string]: string } = {}): Promise<ManifestContainer | undefined> {
	const tgzLayer = await calculateDataLayer(output, dataBytes, path.basename(pathToTgz), DEVCONTAINER_TAR_LAYER_MEDIATYPE);
	if (!tgzLayer) {
		output.write(`Failed to calculate tgz layer.`, LogLevel.Error);
		return undefined;
	}

	// Specific registries look for certain optional metadata 
	// in the manifest, in this case for UI presentation.
	if (ociRef.registry === 'ghcr.io') {
		annotations = {
			...annotations,
			'com.github.package.type': `devcontainer_${collectionType}`,
		};
	}

	return await calculateManifestAndContentDigest(output, ociRef, tgzLayer, annotations);
}

// Generate a layer that follows the `application/vnd.devcontainers.collection.layer.v1+json` mediaType as defined in
//     Devcontainer Spec (features) : https://containers.dev/implementors/features-distribution/#oci-registry
//     Devcontainer Spec (templates): https://github.com/devcontainers/spec/blob/main/proposals/devcontainer-templates-distribution.md#oci-registry
async function generateCompleteManifestForCollectionFile(output: Log, dataBytes: Buffer, collectionRef: OCICollectionRef): Promise<ManifestContainer | undefined> {
	const collectionMetadataLayer = await calculateDataLayer(output, dataBytes, 'devcontainer-collection.json', DEVCONTAINER_COLLECTION_LAYER_MEDIATYPE);
	if (!collectionMetadataLayer) {
		output.write(`Failed to calculate collection file layer.`, LogLevel.Error);
		return undefined;
	}

	let annotations: { [key: string]: string } | undefined = undefined;
	// Specific registries look for certain optional metadata 
	// in the manifest, in this case for UI presentation.
	if (collectionRef.registry === 'ghcr.io') {
		annotations = {
			'com.github.package.type': 'devcontainer_collection',
		};
	}
	return await calculateManifestAndContentDigest(output, collectionRef, collectionMetadataLayer, annotations);
}

// Generic construction of a layer in the manifest and digest for the generated layer.
export async function calculateDataLayer(output: Log, data: Buffer, basename: string, mediaType: string): Promise<OCILayer | undefined> {
	output.write(`Creating manifest from data`, LogLevel.Trace);

	const algorithm = 'sha256';
	const tarSha256 = crypto.createHash(algorithm).update(data).digest('hex');
	const digest = `${algorithm}:${tarSha256}`;
	output.write(`Data layer digest: ${digest} (archive size: ${data.byteLength})`, LogLevel.Info);

	return {
		mediaType,
		digest,
		size: data.byteLength,
		annotations: {
			'org.opencontainers.image.title': basename,
		}
	};
}

// Spec: https://github.com/opencontainers/distribution-spec/blob/main/spec.md#checking-if-content-exists-in-the-registry
//       Requires registry auth token.
export async function checkIfBlobExists(params: CommonParams, ociRef: OCIRef | OCICollectionRef, digest: string): Promise<boolean> {
	const { output } = params;
	
	const url = `https://${ociRef.registry}/v2/${ociRef.path}/blobs/${digest}`;
	const res = await requestEnsureAuthenticated(params, { type: 'HEAD', url, headers: {} }, ociRef);
	if (!res) {
		output.write('Request failed', LogLevel.Error);
		return false;
	}

	const statusCode = res.statusCode;
	output.write(`checkIfBlobExists: ${url}: ${statusCode}`, LogLevel.Trace);
	return statusCode === 200;
}

// Spec: https://github.com/opencontainers/distribution-spec/blob/main/spec.md#post-then-put
//       Requires registry auth token.
async function postUploadSessionId(params: CommonParams, ociRef: OCIRef | OCICollectionRef): Promise<string | undefined> {
	const { output } = params;

	const url = `https://${ociRef.registry}/v2/${ociRef.path}/blobs/uploads/`;
	output.write(`Generating Upload URL -> ${url}`, LogLevel.Trace);
	const res = await requestEnsureAuthenticated(params, { type: 'POST', url, headers: {} }, ociRef);

	if (!res) {
		output.write('Request failed', LogLevel.Error);
		return;
	}

	const { statusCode, resBody, resHeaders } = res;

	output.write(`${url}: ${statusCode}`, LogLevel.Trace);
	if (statusCode === 202) {
		const locationHeader = resHeaders['location'] || resHeaders['Location'];
		if (!locationHeader) {
			output.write(`${url}: Got 202 status code, but no location header found.`, LogLevel.Error);
			return undefined;
		}
		output.write(`Generated Upload URL: ${locationHeader}`, LogLevel.Trace);
		return locationHeader;
	} else {
		// Any other statusCode besides 202 is unexpected
		// https://github.com/opencontainers/distribution-spec/blob/main/spec.md#error-codes
		const parsed = JSON.parse(resBody?.toString() || '{}');
		output.write(`${url}: Unexpected status code '${statusCode}' \n${JSON.stringify(parsed, undefined, 4)}`, LogLevel.Error);
		return undefined;
	}
}

export async function calculateManifestAndContentDigest(output: Log, ociRef: OCIRef | OCICollectionRef, dataLayer: OCILayer, annotations: { [key: string]: string } | undefined): Promise<ManifestContainer> {
	// A canonical manifest digest is the sha256 hash of the JSON representation of the manifest, without the signature content.
	// See: https://docs.docker.com/registry/spec/api/#content-digests
	// Below is an example of a serialized manifest that should resolve to 'dd328c25cc7382aaf4e9ee10104425d9a2561b47fe238407f6c0f77b3f8409fc'
	// {"schemaVersion":2,"mediaType":"application/vnd.oci.image.manifest.v1+json","config":{"mediaType":"application/vnd.devcontainers","digest":"sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a","size":2},"layers":[{"mediaType":"application/vnd.devcontainers.layer.v1+tar","digest":"sha256:0bb92d2da46d760c599d0a41ed88d52521209408b529761417090b62ee16dfd1","size":3584,"annotations":{"org.opencontainers.image.title":"devcontainer-feature-color.tgz"}}],"annotations":{"dev.containers.metadata":"{\"id\":\"color\",\"version\":\"1.0.0\",\"name\":\"A feature to remind you of your favorite color\",\"options\":{\"favorite\":{\"type\":\"string\",\"enum\":[\"red\",\"gold\",\"green\"],\"default\":\"red\",\"description\":\"Choose your favorite color.\"}}}","com.github.package.type":"devcontainer_feature"}}

	let manifest: OCIManifest = {
		schemaVersion: 2,
		mediaType: 'application/vnd.oci.image.manifest.v1+json',
		config: {
			mediaType: 'application/vnd.devcontainers',
			digest: 'sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a', // A empty json byte digest for the devcontainer mediaType.
			size: 2
		},
		layers: [
			dataLayer
		],
	};

	if (annotations) {
		manifest.annotations = annotations;
	}

	const manifestBuffer = Buffer.from(JSON.stringify(manifest));
	const algorithm = 'sha256';
	const manifestHash = crypto.createHash(algorithm).update(manifestBuffer).digest('hex');
	const contentDigest = `${algorithm}:${manifestHash}`;
	output.write(`Computed content digest from manifest: ${contentDigest}`, LogLevel.Info);

	return {
		manifestBuffer,
		manifestObj: manifest,
		contentDigest,
		canonicalId: `${ociRef.resource}@sha256:${manifestHash}`
	};
}
