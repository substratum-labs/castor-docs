import type {ReactNode} from 'react';
import clsx from 'clsx';
import Heading from '@theme/Heading';
import styles from './styles.module.css';

type FeatureItem = {
  title: string;
  icon: string;
  description: ReactNode;
};

const FeatureList: FeatureItem[] = [
  {
    title: 'Capability-Based Security',
    icon: '\u{1F6E1}',
    description: (
      <>
        Depletable budget tokens replace rigid ACLs. Tools declare what they
        consume; the kernel enforces limits. Budget exhaustion degrades
        gracefully with LLM feedback, not crashes.
      </>
    ),
  },
  {
    title: 'Checkpoint / Replay',
    icon: '\u{1F504}',
    description: (
      <>
        Agent state is a replay journal of completed syscalls. Suspend raises
        an interrupt; resume replays from the top with cached responses.
        Deterministic, serializable, crash-recoverable.
      </>
    ),
  },
  {
    title: 'Human-in-the-Loop',
    icon: '\u{1F9D1}\u{200D}\u{2696}\u{FE0F}',
    description: (
      <>
        Destructive operations suspend for human approval. Approve, reject, or
        modify with natural language feedback. The LLM re-plans; the kernel
        never mutates arguments.
      </>
    ),
  },
  {
    title: 'Preemptive Scheduling',
    icon: '\u{23F1}',
    description: (
      <>
        True preemption via <code>asyncio.Task.cancel()</code>. Every LLM
        streaming chunk is a preemption point. Cancel anywhere, resume from
        the last checkpoint, lose nothing.
      </>
    ),
  },
  {
    title: 'Context Window Management',
    icon: '\u{1F9E0}',
    description: (
      <>
        The MMU subsystem monitors token usage, pins system prompts, and
        evicts stale context via FIFO. Semantic page-in retrieves evicted
        memories on demand.
      </>
    ),
  },
  {
    title: 'Framework Agnostic',
    icon: '\u{1F50C}',
    description: (
      <>
        Use Castor as a standalone kernel or as a guard layer for existing
        frameworks. Integrations with LangChain, CrewAI, smolagents, pydantic-ai,
        and more. Your agent, your LLM, Castor&apos;s guarantees.
      </>
    ),
  },
];

function Feature({title, icon, description}: FeatureItem) {
  return (
    <div className={clsx('col col--4')}>
      <div className="text--center padding-horiz--md" style={{marginBottom: '2rem'}}>
        <div style={{fontSize: '3rem', marginBottom: '0.5rem'}}>{icon}</div>
        <Heading as="h3">{title}</Heading>
        <p>{description}</p>
      </div>
    </div>
  );
}

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
