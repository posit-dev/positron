import tar from 'tar';
import * as jsonc from 'jsonc-parser';
import * as os from 'os';
import * as recursiveDirReader from 'recursive-readdir';
import { PackageCommandInput } from './package';
import { cpDirectoryLocal, isLocalFile, isLocalFolder, mkdirpLocal, readLocalDir, readLocalFile, rmLocal, writeLocalFile } from '../../spec-utils/pfs';
import { Log, LogLevel } from '../../spec-utils/log';
import path from 'path';
import { DevContainerConfig, isDockerFileConfig } from '../../spec-configuration/configuration';
import { Template } from '../../spec-configuration/containerTemplatesConfiguration';
import { Feature } from '../../spec-configuration/containerFeaturesConfiguration';
import { getRef } from '../../spec-configuration/containerCollectionsOCI';

export interface SourceInformation {
	source: string;
	owner?: string;
	repo?: string;
	tag?: string;
	ref?: string;
	sha?: string;
}

export const OCICollectionFileName = 'devcontainer-collection.json';

export async function prepPackageCommand(args: PackageCommandInput, collectionType: string): Promise<PackageCommandInput> {
	const { cliHost, targetFolder, outputDir, forceCleanOutputDir, output, disposables } = args;

	const targetFolderResolved = cliHost.path.resolve(targetFolder);
	if (!(await isLocalFolder(targetFolderResolved))) {
		throw new Error(`Target folder '${targetFolderResolved}' does not exist`);
	}

	const outputDirResolved = cliHost.path.resolve(outputDir);
	if (await isLocalFolder(outputDirResolved)) {
		// Output dir exists. Delete it automatically if '-f' is true
		if (forceCleanOutputDir) {
			await rmLocal(outputDirResolved, { recursive: true, force: true });
		}
		else {
			output.write(`(!) ERR: Output directory '${outputDirResolved}' already exists. Manually delete, or pass '-f' to continue.`, LogLevel.Error);
			process.exit(1);
		}
	}

	// Detect if we're packaging a collection or a single feature/template
	const isValidFolder = await isLocalFolder(cliHost.path.join(targetFolderResolved));
	const isSingle = await isLocalFile(cliHost.path.join(targetFolderResolved, `devcontainer-${collectionType}.json`));

	if (!isValidFolder) {
		throw new Error(`Target folder '${targetFolderResolved}' does not exist`);
	}

	// Generate output folder.
	await mkdirpLocal(outputDirResolved);

	return {
		cliHost,
		targetFolder: targetFolderResolved,
		outputDir: outputDirResolved,
		forceCleanOutputDir,
		output,
		disposables,
		isSingle
	};
}

async function tarDirectory(folder: string, archiveName: string, outputDir: string) {
	return new Promise<void>((resolve) => resolve(tar.create({ file: path.join(outputDir, archiveName), cwd: folder }, ['.'])));
}

export const getArchiveName = (f: string, collectionType: string) => `devcontainer-${collectionType}-${f}.tgz`;

export async function packageSingleFeatureOrTemplate(args: PackageCommandInput, collectionType: string) {
	const { output, targetFolder, outputDir } = args;
	let metadatas = [];

	const devcontainerJsonName = `devcontainer-${collectionType}.json`;
	const tmpSrcDir = path.join(os.tmpdir(), `/templates-src-output-${Date.now()}`);
	await cpDirectoryLocal(targetFolder, tmpSrcDir);

	const jsonPath = path.join(tmpSrcDir, devcontainerJsonName);
	if (!(await isLocalFile(jsonPath))) {
		output.write(`${collectionType} is missing a ${devcontainerJsonName}`, LogLevel.Error);
		return;
	}

	if (collectionType === 'template') {
		if (!(await addsAdditionalTemplateProps(tmpSrcDir, jsonPath, output))) {
			return;
		}
	} else if (collectionType === 'feature') {
		await addsAdditionalFeatureProps(jsonPath, output);
	}

	const metadata = jsonc.parse(await readLocalFile(jsonPath, 'utf-8'));
	if (!metadata.id || !metadata.version || !metadata.name) {
		output.write(`${collectionType} is missing one of the following required properties in its devcontainer-${collectionType}.json: 'id', 'version', 'name'.`, LogLevel.Error);
		return;
	}

	const archiveName = getArchiveName(metadata.id, collectionType);

	await tarDirectory(tmpSrcDir, archiveName, outputDir);
	output.write(`Packaged ${collectionType} '${metadata.id}'`, LogLevel.Info);

	metadatas.push(metadata);
	await rmLocal(tmpSrcDir, { recursive: true, force: true });
	return metadatas;
}

async function addsAdditionalTemplateProps(srcFolder: string, devcontainerTemplateJsonPath: string, output: Log): Promise<boolean> {
	const devcontainerFilePath = await getDevcontainerFilePath(srcFolder);

	if (!devcontainerFilePath) {
		output.write(`Template is missing a devcontainer.json`, LogLevel.Error);
		return false;
	}

	const devcontainerJsonString: Buffer = await readLocalFile(devcontainerFilePath);
	const config: DevContainerConfig = jsonc.parse(devcontainerJsonString.toString());

	let type = undefined;
	const devcontainerTemplateJsonString: Buffer = await readLocalFile(devcontainerTemplateJsonPath);
	let templateData: Template = jsonc.parse(devcontainerTemplateJsonString.toString());

	if ('image' in config) {
		type = 'image';
	} else if (isDockerFileConfig(config)) {
		type = 'dockerfile';
	} else if ('dockerComposeFile' in config) {
		type = 'dockerCompose';
	} else {
		output.write(`Dev container config (${devcontainerFilePath}) is missing one of "image", "dockerFile" or "dockerComposeFile" properties.`, LogLevel.Error);
		return false;
	}

	const fileNames = (await recursiveDirReader.default(srcFolder))?.map((f) => path.relative(srcFolder, f)) ?? [];

	templateData.type = type;
	templateData.files = fileNames;
	templateData.fileCount = fileNames.length;
	templateData.featureIds =
		config.features
			? Object.keys(config.features)
				.map((f) => getRef(output, f)?.resource)
				.filter((f) => f !== undefined) as string[]
			: [];

	// If the Template is omitting a folder and that folder contains just a single file, 
	// replace the entry in the metadata with the full file name,
	// as that provides a better user experience when tools consume the metadata.
	// Eg: If the template is omitting ".github/*" and the Template source contains just a single file
	//     "workflow.yml", replace ".github/*" with ".github/workflow.yml"
	if (templateData.optionalPaths && templateData.optionalPaths?.length) {
		const optionalPaths = templateData.optionalPaths;
		for (const optPath of optionalPaths) {
			// Skip if not a directory
			if (!optPath.endsWith('/*') || optPath.length < 3) {
				continue;
			}
			const dirPath = optPath.slice(0, -2);
			const dirFiles = fileNames.filter((f) => f.startsWith(dirPath));
			output.write(`Given optionalPath starting with '${dirPath}' has ${dirFiles.length} files`, LogLevel.Trace);
			if (dirFiles.length === 1) {
				// If that one item is a file and not a directory
				const f = dirFiles[0];
				output.write(`Checking if optionalPath '${optPath}' with lone contents '${f}' is a file `, LogLevel.Trace);
				const localPath = path.join(srcFolder, f);
				if (await isLocalFile(localPath)) {
					output.write(`Checked path '${localPath}' on disk is a file. Replacing optionalPaths entry '${optPath}' with '${f}'`, LogLevel.Trace);
					templateData.optionalPaths[optionalPaths.indexOf(optPath)] = f;
				}
			}
		}
	}

	await writeLocalFile(devcontainerTemplateJsonPath, JSON.stringify(templateData, null, 4));

	return true;
}

// Programmatically adds 'currentId' if 'legacyIds' exist.
async function addsAdditionalFeatureProps(devcontainerFeatureJsonPath: string, output: Log): Promise<void> {
	const devcontainerFeatureJsonString: Buffer = await readLocalFile(devcontainerFeatureJsonPath);
	let featureData: Feature = jsonc.parse(devcontainerFeatureJsonString.toString());

	if (featureData.legacyIds && featureData.legacyIds.length > 0) {
		featureData.currentId = featureData.id;
		output.write(`Programmatically adding currentId:${featureData.currentId}...`, LogLevel.Trace);

		await writeLocalFile(devcontainerFeatureJsonPath, JSON.stringify(featureData, null, 4));
	}
}

async function getDevcontainerFilePath(srcFolder: string): Promise<string | undefined> {
	const devcontainerFile = path.join(srcFolder, '.devcontainer.json');
	const devcontainerFileWithinDevcontainerFolder = path.join(srcFolder, '.devcontainer/devcontainer.json');

	if (await isLocalFile(devcontainerFile)) {
		return devcontainerFile;
	} else if (await isLocalFile(devcontainerFileWithinDevcontainerFolder)) {
		return devcontainerFileWithinDevcontainerFolder;
	}

	return undefined;
}

// Packages collection of Features or Templates
export async function packageCollection(args: PackageCommandInput, collectionType: string) {
	const { output, targetFolder: srcFolder, outputDir } = args;

	const collectionDirs = await readLocalDir(srcFolder);
	let metadatas = [];

	for await (const c of collectionDirs) {
		output.write(`Processing ${collectionType}: ${c}...`, LogLevel.Info);
		if (!c.startsWith('.')) {
			const folder = path.join(srcFolder, c);

			// Validate minimal folder structure
			const devcontainerJsonName = `devcontainer-${collectionType}.json`;

			if (!(await isLocalFile(path.join(folder, devcontainerJsonName)))) {
				output.write(`(!) WARNING: ${collectionType} '${c}' is missing a ${devcontainerJsonName}. Skipping... `, LogLevel.Warning);
				continue;
			}

			const tmpSrcDir = path.join(os.tmpdir(), `/templates-src-output-${Date.now()}`);
			await cpDirectoryLocal(folder, tmpSrcDir);

			const archiveName = getArchiveName(c, collectionType);

			const jsonPath = path.join(tmpSrcDir, devcontainerJsonName);

			if (collectionType === 'feature') {
				const installShPath = path.join(tmpSrcDir, 'install.sh');
				if (!(await isLocalFile(installShPath))) {
					output.write(`Feature '${c}' is missing an install.sh`, LogLevel.Error);
					return;
				}

				await addsAdditionalFeatureProps(jsonPath, output);
			} else if (collectionType === 'template') {
				if (!(await addsAdditionalTemplateProps(tmpSrcDir, jsonPath, output))) {
					return;
				}
			}

			await tarDirectory(tmpSrcDir, archiveName, outputDir);

			const metadata = jsonc.parse(await readLocalFile(jsonPath, 'utf-8'));
			if (!metadata.id || !metadata.version || !metadata.name) {
				output.write(`${collectionType} '${c}' is missing one of the following required properties in its ${devcontainerJsonName}: 'id', 'version', 'name'.`, LogLevel.Error);
				return;
			}
			metadatas.push(metadata);
			await rmLocal(tmpSrcDir, { recursive: true, force: true });
		}
	}

	if (metadatas.length === 0) {
		return;
	}

	output.write(`Packaged ${metadatas.length} ${collectionType}s!`, LogLevel.Info);
	return metadatas;
}
