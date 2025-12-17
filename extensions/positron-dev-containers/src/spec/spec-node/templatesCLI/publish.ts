import path from 'path';
import * as os from 'os';
import { Argv } from 'yargs';
import { LogLevel, mapLogLevel } from '../../spec-utils/log';
import { rmLocal } from '../../spec-utils/pfs';
import { getPackageConfig } from '../../spec-utils/product';
import { createLog } from '../devContainers';
import { UnpackArgv } from '../devContainersSpecCLI';
import { publishOptions } from '../collectionCommonUtils/publish';
import { getCLIHost } from '../../spec-common/cliHost';
import { loadNativeModule } from '../../spec-common/commonUtils';
import { PackageCommandInput } from '../collectionCommonUtils/package';
import { getArchiveName } from '../collectionCommonUtils/packageCommandImpl';
import { packageTemplates } from './packageImpl';
import { getCollectionRef, getRef, OCICollectionRef } from '../../spec-configuration/containerCollectionsOCI';
import { doPublishCommand, doPublishMetadata } from '../collectionCommonUtils/publishCommandImpl';
import { runAsyncHandler } from '../utils';

const collectionType = 'template';

export function templatesPublishOptions(y: Argv) {
    return publishOptions(y, 'template');
}

export type TemplatesPublishArgs = UnpackArgv<ReturnType<typeof templatesPublishOptions>>;

export function templatesPublishHandler(args: TemplatesPublishArgs) {
	runAsyncHandler(templatesPublish.bind(null, args));
}

async function templatesPublish({
    'target': targetFolder,
    'log-level': inputLogLevel,
    'registry': registry,
    'namespace': namespace
}: TemplatesPublishArgs) {
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

    // Package templates
    const outputDir = path.join(os.tmpdir(), `/templates-output-${Date.now()}`);

    const packageArgs: PackageCommandInput = {
        cliHost,
        targetFolder,
        outputDir,
        output,
        disposables,
        forceCleanOutputDir: true,
    };

    const metadata = await packageTemplates(packageArgs);

    if (!metadata) {
        process.exit(1);
    }

    let result = {};

    for (const t of metadata.templates) {
        output.write(`Processing template: ${t.id}...`, LogLevel.Info);

        if (!t.version) {
            output.write(`(!) WARNING: Version does not exist, skipping ${t.id}...`, LogLevel.Warning);
            continue;
        }

        const resource = `${registry}/${namespace}/${t.id}`;
        const templateRef = getRef(output, resource);
        if (!templateRef) {
            output.write(`(!) Could not parse provided Template identifier: '${resource}'`, LogLevel.Error);
            process.exit(1);
        }

        const archiveName = getArchiveName(t.id, collectionType);

        // Properties here are available on the manifest without needing to download the full Template archive.
        const templateAnnotations = {
            'dev.containers.metadata': JSON.stringify(t),
        };
        output.write(`Template Annotations: ${JSON.stringify(templateAnnotations)}`, LogLevel.Debug);

        const publishResult = await doPublishCommand(params, t.version, templateRef, outputDir, collectionType, archiveName, templateAnnotations);
        if (!publishResult) {
            output.write(`(!) ERR: Failed to publish '${resource}'`, LogLevel.Error);
            process.exit(1);
        }

        const thisResult = (publishResult?.digest && publishResult?.publishedTags?.length > 0) ? {
            ...publishResult,
            version: t.version,
        } : {};

        result = {
            ...result,
            [t.id]: thisResult,
        };
    }

    const templateCollectionRef: OCICollectionRef | undefined = getCollectionRef(output, registry, namespace);
    if (!templateCollectionRef) {
        output.write(`(!) Could not parse provided collection identifier with registry '${registry}' and namespace '${namespace}'`, LogLevel.Error);
        process.exit(1);
    }

    if (! await doPublishMetadata(params, templateCollectionRef, outputDir, collectionType)) {
        output.write(`(!) ERR: Failed to publish '${templateCollectionRef.registry}/${templateCollectionRef.path}'`, LogLevel.Error);
        process.exit(1);
    }

    console.log(JSON.stringify(result));

    // Cleanup
    await rmLocal(outputDir, { recursive: true, force: true });
    await dispose();
    process.exit();
}
