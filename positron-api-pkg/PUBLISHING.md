# Publishing @posit-dev/positron

This guide explains how to publish the `@posit-dev/positron` package to npm. This should be done after any changes to the Positron API. (Eventually this will be automated using CI.)

_This guide is not included in the readme because the readme is displayed on the NPM package page and it would be confusing to have two different guides._

## Prerequisites

1. **NPM Account**: You need an npm account with access to publish under the `@posit-dev` scope
2. **Authentication**: Login to npm with `npm login`
3. **Permissions**: Ensure you have publish permissions for the `@posit-dev` organization

## Publishing Process

### 1. Build the Package

From the root of the Positron repository:

```bash
npm run build-api-pkg
```

Or from the package directory:

```bash
cd positron-api-pkg
npm run build
```

This will run a comprehensive build script that:
1. Gathers the latest type definitions from Positron source
2. Compiles TypeScript source code
3. Copies ambient module declarations to distribution
4. Adds reference directives for proper module resolution

The build process creates:
- `dist/index.js` - Compiled JavaScript with runtime detection
- `dist/index.d.ts` - Main TypeScript definitions with reference directives
- `dist/positron.d.ts` - Ambient module declarations for 'positron' namespace
- `dist/ui-comm.d.ts` - Ambient module declarations for 'ui-comm' namespace

### 2. Update Version

Navigate to the package directory and update the version:

```bash
cd positron-api-pkg
npm version patch  # or minor/major as appropriate
```

### 3. Publish

```bash
npm publish
```

The `prepublishOnly` script will automatically rebuild the package before publishing.

## Version Guidelines

Follow semantic versioning:

- **Major**: Breaking changes to the API
- **Minor**: New API features (backward compatible)
- **Patch**: Bug fixes, documentation updates

## Automated Publishing (Future)

Consider setting up automated publishing via GitHub Actions:

1. On Positron releases
2. When type definitions change
3. With proper version bumping based on changes

## Troubleshooting

### Permission Denied
```bash
npm login
# Ensure you're logged in with correct credentials
```

### Package Already Exists
Check if version was already published:
```bash
npm view @posit-dev/positron versions --json
```

### Build Failures
Ensure the main Positron build works:
```bash
cd ../..
npm run compile
npm run build-js-sdk
```

Or from the package directory:
```bash
npm run clean
npm run build
```
