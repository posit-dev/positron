import { Argv } from 'yargs';

const targetPositionalDescription = (collectionType: string) => `
Package and publish ${collectionType}s at provided [target] (default is cwd), where [target] is either:
   1. A path to the src folder of the collection with [1..n] ${collectionType}s.
   2. A path to a single ${collectionType} that contains a devcontainer-${collectionType}.json.
`;

export function publishOptions(y: Argv, collectionType: string) {
    return y
        .options({
            'registry': { type: 'string', alias: 'r', default: 'ghcr.io', description: 'Name of the OCI registry.' },
            'namespace': { type: 'string', alias: 'n', require: true, description: `Unique indentifier for the collection of ${collectionType}s. Example: <owner>/<repo>` },
            'log-level': { choices: ['info' as 'info', 'debug' as 'debug', 'trace' as 'trace'], default: 'info' as 'info', description: 'Log level.' }
        })
        .positional('target', { type: 'string', default: '.', description: targetPositionalDescription(collectionType) })
        .check(_argv => {
            return true;
        });
}
