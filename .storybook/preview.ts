import type { Preview } from '@storybook/react';
import './generated/theme-all.css';
import './storybook-base.css';

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
};

export default preview;
