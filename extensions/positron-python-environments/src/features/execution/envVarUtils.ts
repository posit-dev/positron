import { Uri } from 'vscode';
import { readFile } from '../../common/workspace.fs.apis';
import { parse } from 'dotenv';

export function mergeEnvVariables(
    base: { [key: string]: string | undefined },
    other: { [key: string]: string | undefined },
) {
    const env: { [key: string]: string | undefined } = {};

    Object.keys(other).forEach((otherKey) => {
        let value = other[otherKey];
        if (value === undefined || value === '') {
            // SOME_ENV_VAR=
            delete env[otherKey];
        } else {
            Object.keys(base).forEach((baseKey) => {
                const baseValue = base[baseKey];
                if (baseValue) {
                    value = value?.replace(`\${${baseKey}}`, baseValue);
                }
            });
            env[otherKey] = value;
        }
    });

    return env;
}

export async function parseEnvFile(envFile: Uri): Promise<{ [key: string]: string | undefined }> {
    const raw = await readFile(envFile);
    const contents = Buffer.from(raw).toString('utf-8');
    return parse(contents);
}
