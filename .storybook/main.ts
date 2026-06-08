import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  stories: ['../src/vs/workbench/contrib/positronNotebook/browser/**/*.stories.tsx'],
  framework: '@storybook/react-vite',
  addons: ['@storybook/addon-essentials'],
  viteFinal: (config) => {
    // Reuse the same resolve settings as vitest so .js extension imports work
    config.resolve = {
      ...config.resolve,
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
      extensionAlias: {
        '.js': ['.ts', '.tsx', '.js'],
      },
    };
    return config;
  },
};

export default config;
