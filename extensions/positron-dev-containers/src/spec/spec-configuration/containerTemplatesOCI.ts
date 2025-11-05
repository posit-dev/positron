import { Log, LogLevel } from '../spec-utils/log';
import * as os from 'os';
import * as path from 'path';
import * as jsonc from 'jsonc-parser';
import { CommonParams, fetchOCIManifestIfExists, getBlob, getRef, ManifestContainer } from './containerCollectionsOCI';
import { isLocalFile, readLocalFile, writeLocalFile } from '../spec-utils/pfs';
import { DevContainerConfig } from './configuration';
import { Template } from './containerTemplatesConfiguration';

export interface TemplateOptions {
	[name: string]: string;
}
export interface TemplateFeatureOption {
	id: string;
	options: Record<string, boolean | string | undefined>;
}

export interface SelectedTemplate {
	id: string;
	options: TemplateOptions;
	features: TemplateFeatureOption[];
	omitPaths: string[];
}

export async function fetchTemplate(params: CommonParams, selectedTemplate: SelectedTemplate, templateDestPath: string, userProvidedTmpDir?: string): Promise<string[] | undefined> {
	const { output } = params;

	let { id: userSelectedId, options: userSelectedOptions, omitPaths } = selectedTemplate;
	const templateRef = getRef(output, userSelectedId);
	if (!templateRef) {
		output.write(`Failed to parse template ref for ${userSelectedId}`, LogLevel.Error);
		return;
	}

	const ociManifest = await fetchOCITemplateManifestIfExistsFromUserIdentifier(params, userSelectedId);
	if (!ociManifest) {
		output.write(`Failed to fetch template manifest for ${userSelectedId}`, LogLevel.Error);
		return;
	}
	const blobDigest = ociManifest?.manifestObj?.layers[0]?.digest;
	if (!blobDigest) {
		output.write(`Failed to fetch template manifest for ${userSelectedId}`, LogLevel.Error);
		return;
	}

	const blobUrl = `https://${templateRef.registry}/v2/${templateRef.path}/blobs/${blobDigest}`;
	output.write(`blob url: ${blobUrl}`, LogLevel.Trace);

	const tmpDir = userProvidedTmpDir || path.join(os.tmpdir(), 'vsch-template-temp', `${Date.now()}`);
	const blobResult = await getBlob(params, blobUrl, tmpDir, templateDestPath, templateRef, blobDigest, [...omitPaths, 'devcontainer-template.json', 'README.md', 'NOTES.md'], 'devcontainer-template.json');

	if (!blobResult) {
		output.write(`Failed to download package for ${templateRef.resource}`, LogLevel.Error);
		return;
	}

	const { files, metadata } = blobResult;

	// Auto-replace default values for values not provided by user.
	if (metadata) {
		const templateMetadata = metadata as Template;
		if (templateMetadata.options) {
			const templateOptions = templateMetadata.options;
			for (const templateOptionKey of Object.keys(templateOptions)) {
				if (userSelectedOptions[templateOptionKey] === undefined) {
					// If the user didn't provide a value for this option, use the default if there is one in the extracted metadata.
					const templateOption = templateOptions[templateOptionKey];

					if (templateOption.type === 'string') {
						const _default = templateOption.default;
						if (_default) {
							output.write(`Using default value for ${templateOptionKey} --> ${_default}`, LogLevel.Trace);
							userSelectedOptions[templateOptionKey] = _default;
						}
					}
					else if (templateOption.type === 'boolean') {
						const _default = templateOption.default;
						if (_default) {
							output.write(`Using default value for ${templateOptionKey} --> ${_default}`, LogLevel.Trace);
							userSelectedOptions[templateOptionKey] = _default.toString();
						}
					}
				}
			}
		}
	}

	// Scan all template files and replace any templated values.
	for (const f of files) {
		output.write(`Scanning file '${f}'`, LogLevel.Trace);
		const filePath = path.join(templateDestPath, f);
		if (await isLocalFile(filePath)) {
			const fileContents = await readLocalFile(filePath);
			const fileContentsReplaced = replaceTemplatedValues(output, fileContents.toString(), userSelectedOptions);
			await writeLocalFile(filePath, Buffer.from(fileContentsReplaced));
		} else {
			output.write(`Could not find templated file '${f}'.`, LogLevel.Error);
		}
	}

	// Get the config.  A template should not have more than one devcontainer.json.
	const config = async (files: string[]) => {
		const p = files.find(f => f.endsWith('devcontainer.json'));
		if (p) {
			const configPath = path.join(templateDestPath, p);
			if (await isLocalFile(configPath)) {
				const configContents = await readLocalFile(configPath);
				return {
					configPath,
					configText: configContents.toString(),
					configObject: jsonc.parse(configContents.toString()) as DevContainerConfig,
				};
			}
		}
		return undefined;
	};

	if (selectedTemplate.features.length !== 0) {
		const configResult = await config(files);
		if (configResult) {
			await addFeatures(output, selectedTemplate.features, configResult);
		} else {
			output.write(`Could not find a devcontainer.json to apply selected Features onto.`, LogLevel.Error);
		}
	}

	return files;
}


async function fetchOCITemplateManifestIfExistsFromUserIdentifier(params: CommonParams, identifier: string, manifestDigest?: string): Promise<ManifestContainer | undefined> {
	const { output } = params;

	const templateRef = getRef(output, identifier);
	if (!templateRef) {
		return undefined;
	}
	return await fetchOCIManifestIfExists(params, templateRef, manifestDigest);
}

function replaceTemplatedValues(output: Log, template: string, options: TemplateOptions) {
	const pattern = /\${templateOption:\s*(\w+?)\s*}/g; // ${templateOption:XXXX}
	return template.replace(pattern, (_, token) => {
		output.write(`Replacing ${token} with ${options[token]}`);
		return options[token] || '';
	});
}

async function addFeatures(output: Log, newFeatures: TemplateFeatureOption[], configResult: { configPath: string; configText: string; configObject: DevContainerConfig }) {
	const { configPath, configText, configObject } = configResult;
	if (newFeatures) {
		let previousText = configText;
		let updatedText = configText;

		// Add the features property if it doesn't exist.
		if (!configObject.features) {
			const edits = jsonc.modify(updatedText, ['features'], {}, { formattingOptions: {} });
			updatedText = jsonc.applyEdits(updatedText, edits);
		}

		for (const newFeature of newFeatures) {
			let edits: jsonc.Edit[] = [];
			const propertyPath = ['features', newFeature.id];

			edits = edits.concat(
				jsonc.modify(updatedText, propertyPath, newFeature.options ?? {}, { formattingOptions: {} }
				));

			updatedText = jsonc.applyEdits(updatedText, edits);
		}

		if (previousText !== updatedText) {
			output.write(`Updating ${configPath} with ${newFeatures.length} Features`, LogLevel.Trace);
			await writeLocalFile(configPath, Buffer.from(updatedText));
		}
	}
}