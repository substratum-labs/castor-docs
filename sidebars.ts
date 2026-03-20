import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    'intro',
    {
      type: 'category',
      label: 'Getting Started',
      items: [
        'getting-started/installation',
        'getting-started/quickstart',
        'getting-started/concepts',
      ],
    },
    {
      type: 'category',
      label: 'Architecture',
      items: [
        'architecture/overview',
        'architecture/checkpoint-replay',
        'architecture/preemption',
        'architecture/capability-model',
        'architecture/mmu',
      ],
    },
    {
      type: 'category',
      label: 'Guides',
      items: [
        'guides/castor-lib',
        'guides/hitl-patterns',
        'guides/multi-agent',
        'guides/budget-management',
        'guides/framework-integration',
      ],
    },
    {
      type: 'category',
      label: 'Whitepaper',
      items: ['whitepaper/index'],
    },
    {
      type: 'link',
      label: 'Roche (Sandbox)',
      href: 'https://substratum-labs.github.io/roche-docs/',
    },
  ],
};

export default sidebars;
