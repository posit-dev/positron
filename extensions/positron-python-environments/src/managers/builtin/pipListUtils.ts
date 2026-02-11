export interface PipPackage {
    name: string;
    version: string;
    displayName: string;
    description: string;
}
export function isValidVersion(version: string): boolean {
    return /^([1-9][0-9]*!)?(0|[1-9][0-9]*)(\.(0|[1-9][0-9]*))*((a|b|rc)(0|[1-9][0-9]*))?(\.post(0|[1-9][0-9]*))?(\.dev(0|[1-9][0-9]*))?$/.test(
        version,
    );
}
export function parsePipList(data: string): PipPackage[] {
    const collection: PipPackage[] = [];

    const lines = data.split('\n').splice(2);
    for (let line of lines) {
        if (line.trim() === '' || line.startsWith('Package') || line.startsWith('----') || line.startsWith('[')) {
            continue;
        }
        const parts = line.split(' ').filter((e) => e);
        if (parts.length === 2) {
            const name = parts[0].trim();
            const version = parts[1].trim();
            if (!isValidVersion(version)) {
                continue;
            }
            const pkg = {
                name,
                version,
                displayName: name,
                description: version,
            };
            collection.push(pkg);
        }
    }
    return collection;
}
