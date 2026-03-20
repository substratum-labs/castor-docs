import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'Castor',
  tagline: 'A Secure Microkernel for LLM Agents',
  favicon: 'img/favicon.ico',

  future: {
    v4: true,
  },

  url: 'https://substratum-labs.github.io',
  baseUrl: '/castor-docs/',

  organizationName: 'substratum-labs',
  projectName: 'castor-docs',

  onBrokenLinks: 'throw',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/substratum-labs/castor-docs/edit/main/',
        },
        blog: {
          showReadingTime: true,
          blogTitle: 'Castor Engineering Blog',
          blogDescription: 'Technical deep-dives from the Castor team',
          postsPerPage: 5,
          blogSidebarCount: 'ALL',
          feedOptions: {
            type: ['rss', 'atom'],
            xslt: true,
          },
          editUrl: 'https://github.com/substratum-labs/castor-docs/edit/main/',
          onInlineTags: 'warn',
          onInlineAuthors: 'warn',
          onUntruncatedBlogPosts: 'warn',
        },
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    image: 'img/castor-social-card.png',
    colorMode: {
      defaultMode: 'light',
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'Castor',
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docsSidebar',
          position: 'left',
          label: 'Docs',
        },
        {
          to: '/docs/whitepaper/',
          label: 'Whitepaper',
          position: 'left',
        },
        {to: '/blog', label: 'Blog', position: 'left'},
        {
          href: 'https://substratum-labs.github.io/castor/',
          label: 'API Reference',
          position: 'left',
        },
        {
          href: 'https://github.com/substratum-labs/castor',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Documentation',
          items: [
            {label: 'Getting Started', to: '/docs/getting-started/quickstart'},
            {label: 'Architecture', to: '/docs/architecture/overview'},
            {label: 'Whitepaper', to: '/docs/whitepaper/'},
          ],
        },
        {
          title: 'Reference',
          items: [
            {
              label: 'API Docs',
              href: 'https://substratum-labs.github.io/castor/',
            },
            {
              label: 'GitHub',
              href: 'https://github.com/substratum-labs/castor',
            },
            {
              label: 'PyPI',
              href: 'https://pypi.org/project/castor/',
            },
          ],
        },
        {
          title: 'Community',
          items: [
            {label: 'Blog', to: '/blog'},
            {
              label: 'Issues',
              href: 'https://github.com/substratum-labs/castor/issues',
            },
          ],
        },
      ],
      copyright: `Copyright &copy; ${new Date().getFullYear()} Substratum Labs. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['python', 'rust', 'toml', 'bash'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
