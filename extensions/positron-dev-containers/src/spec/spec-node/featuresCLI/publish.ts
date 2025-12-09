import path from 'path';
import * as os from 'os';
import { Argv } from 'yargs';
import { LogLevel, mapLogLevel } from '../../spec-utils/log';
import { rmLocal } from '../../spec-utils/pfs';
import { getPackageConfig } from '../../spec-utils/product';
import { createLog } from '../devContainers';
import { UnpackArgv } from '../devContainersSpecCLI';
import { doFeaturesPackageCommand } from './packageCommandImpl';
import { getCLIHost } from '../../spec-common/cliHost';
import { loadNativeModule } from '../../spec-common/commonUtils';
import { PackageCommandInput } from '../collectionCommonUtils/package';
import { getArchiveName, OCICollectionFileName } from '../collectionCommonUtils/packageCommandImpl';
import { publishOptions } from '../collectionCommonUtils/publish';
import { getCollectionRef, getRef, OCICollectionRef } from '../../spec-configuration/containerCollectionsOCI';
import { doPublishCommand, doPublishMetadata } from '../collectionCommonUtils/publishCommandImpl';
import { runAsyncHandler } from '../utils';

const collectionType = 'feature';
export function featuresPublishOptions(y: Argv) {
    return publishOptions(y, 'feature');
}

export type FeaturesPublishArgs = UnpackArgv<ReturnType<typeof featuresPublishOptions>>;

export function featuresPublishHandler(args: FeaturesPublishArgs) {
	runAsyncHandler(featuresPublish.bind(null, args));
}

async function featuresPublish({
    'target': targetFolder,
    'log-level': inputLogLevel,
    'registry': registry,
    'namespace': namespace
}: FeaturesPublishArgs) {
    const disposables: (() => Promise<unknown> | undefined)[] = [];
    const dispose = async () => {
        await Promise.all(disposables.map(d => d()));
    };

    const pkg = getPackageConfig();

    const cwd = process.cwd();
    const cliHost = await getCLIHost(cwd, loadNativeModule, true);
    const output = createLog({
        logLevel: mapLogLevel(inputLogLevel),
        logFormat: 'text',
        log: (str) => process.stderr.write(str),
        terminalDimensions: undefined,
    }, pkg, new Date(), disposables);

    const params = { output, env: process.env };

    // Package features
    const outputDir = path.join(os.tmpdir(), `/features-output-${Date.now()}`);

    const packageArgs: PackageCommandInput = {
        cliHost,
        targetFolder,
        outputDir,
        output,
        disposables,
        forceCleanOutputDir: true,
    };

    const metadata = await doFeaturesPackageCommand(packageArgs);

    if (!metadata) {
        output.write(`(!) ERR: Failed to fetch ${OCICollectionFileName}`, LogLevel.Error);
        process.exit(1);
    }

    let result = {};

    for (const f of metadata.features) {
        output.write(`Processing feature: ${f.id}...`, LogLevel.Info);

        if (!f.version) {
            output.write(`(!) WARNING: Version does not exist, skipping ${f.id}...`, LogLevel.Warning);
            continue;
        }

        const resource = `${registry}/${namespace}/${f.id}`;
        const featureRef = getRef(output, resource);
        if (!featureRef) {
            output.write(`(!) Could not parse provided Feature identifier: '${resource}'`, LogLevel.Error);
            process.exit(1);
        }

        const archiveName = getArchiveName(f.id, collectionType);

        // Properties here are available on the manifest without needing to download the full Feature archive.
        const featureAnnotations = {
            'dev.containers.metadata': JSON.stringify(f),
        };
        output.write(`Feature Annotations: ${JSON.stringify(featureAnnotations)}`, LogLevel.Debug);

        const publishResult = await doPublishCommand(params, f.version, featureRef, outputDir, collectionType, archiveName, featureAnnotations);
        if (!publishResult) {
            output.write(`(!) ERR: Failed to publish '${resource}'`, LogLevel.Error);
            process.exit(1);
        }

        const isPublished = (publishResult?.digest && publishResult?.publishedTags.length > 0);
        let thisResult = isPublished ? {
            ...publishResult,
            version: f.version,
        } : {};

        if (isPublished && f.legacyIds) {
            output.write(`Processing legacyIds for '${f.id}'...`, LogLevel.Info);

            let publishedLegacyIds: string[] = [];
            for await (const legacyId of f.legacyIds) {
                output.write(`Processing legacyId: '${legacyId}'...`, LogLevel.Info);
                let legacyResource = `${registry}/${namespace}/${legacyId}`;
                const legacyFeatureRef = getRef(output, legacyResource);

                if (!legacyFeatureRef) {
                    output.write(`(!) Could not parse provided Feature identifier: '${legacyResource}'`, LogLevel.Error);
                    process.exit(1);
                }

                const publishResult = await doPublishCommand(params, f.version, legacyFeatureRef, outputDir, collectionType, archiveName, featureAnnotations);
                if (!publishResult) {
                    output.write(`(!) ERR: Failed to publish '${legacyResource}'`, LogLevel.Error);
                    process.exit(1);
                }

                if (publishResult?.digest && publishResult?.publishedTags.length > 0) {
                    publishedLegacyIds.push(legacyId);
                }
            }

            if (publishedLegacyIds.length > 0) {
                thisResult = {
                    ...thisResult,
                    publishedLegacyIds,
                };
            }
        }

        result = {
            ...result,
            [f.id]: thisResult,
        };
    }

    const featureCollectionRef: OCICollectionRef | undefined = getCollectionRef(output, registry, namespace);
    if (!featureCollectionRef) {
        output.write(`(!) Could not parse provided collection identifier with registry '${registry}' and namespace '${namespace}'`, LogLevel.Error);
        process.exit(1);
    }

    if (! await doPublishMetadata(params, featureCollectionRef, outputDir, collectionType)) {
        output.write(`(!) ERR: Failed to publish '${featureCollectionRef.registry}/${featureCollectionRef.path}'`, LogLevel.Error);
        process.exit(1);
    }

    console.log(JSON.stringify(result));

    // Cleanup
    await rmLocal(outputDir, { recursive: true, force: true });
    await dispose();
    process.exit();
}
