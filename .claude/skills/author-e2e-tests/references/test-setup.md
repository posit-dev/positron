# Test Setup

In a freshly cloned repository without previous build artifacts or build
daemons running, the following steps will prepare the machine to run tests:

```
# Install Node packages (node_modules) for Positron itself
npm install

# Install dependencies for the e2e tests.
npm --prefix test/e2e install

# Compile Positron and install Electron.
npm exec -- npm-run-all --max-old-space-size=8192 -p compile electron

# Install Playwright and dependencies
npx playwright install --with-deps

# Install dependencies required to launch Positron, such as bootstrapped extensions
npm run prelaunch
```

See also the Positron E2E Test Guide in test/e2e/README.md for other setup
help, including required environment variables.

If you run into trouble, it may be helpful to look at the Github workflows to
see how they prepare fresh environments for running tests; for example in
.github/workflows/test-e2e-ubuntu.yml.


