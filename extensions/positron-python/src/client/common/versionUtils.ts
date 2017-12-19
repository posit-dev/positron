import * as semver from 'semver';

export class VersionUtils {
    public static convertToSemver(version: string) {
        const versionParts = (version || '').split('.').filter(item => item.length > 0);
        while (versionParts.length < 3) {
            versionParts.push('0');
        }
        return versionParts.join('.');
    }
    public static compareVersion(versionA: string, versionB: string) {
        try {
            versionA = VersionUtils.convertToSemver(versionA);
            versionB = VersionUtils.convertToSemver(versionB);
            return semver.gt(versionA, versionB) ? 1 : 0;
        }
        catch {
            return 0;
        }
    }

}