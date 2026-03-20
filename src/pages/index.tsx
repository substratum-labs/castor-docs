import type {ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import Layout from '@theme/Layout';
import HomepageFeatures from '@site/src/components/HomepageFeatures';
import Heading from '@theme/Heading';

import styles from './index.module.css';

function HomepageHeader() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className={clsx('hero hero--primary', styles.heroBanner)}>
      <div className="container">
        <Heading as="h1" className="hero__title">
          {siteConfig.title}
        </Heading>
        <p className="hero__subtitle">{siteConfig.tagline}</p>
        <p className={styles.heroDescription}>
          Castor cages LLMs inside a deterministic execution engine with
          strongly-typed tool validation, capability-based security budgets,
          and preemptive human-in-the-loop interrupts.
        </p>
        <div className={styles.buttons}>
          <Link
            className="button button--secondary button--lg"
            to="/docs/getting-started/quickstart">
            Get Started
          </Link>
          <Link
            className="button button--outline button--lg"
            to="/docs/whitepaper/"
            style={{marginLeft: '1rem', color: 'white', borderColor: 'white'}}>
            Read the Whitepaper
          </Link>
        </div>
      </div>
    </header>
  );
}

function CodePreview() {
  return (
    <section className={styles.codePreview}>
      <div className="container">
        <div className="row">
          <div className="col col--8 col--offset-2">
            <Heading as="h2" className="text--center" style={{marginBottom: '1.5rem'}}>
              Secure by Default
            </Heading>
            <pre className={styles.codeBlock}>
              <code>{`from castor import Castor, SyscallProxy, castor_tool

@castor_tool(consumes="api", cost_per_use=1.0)
async def web_search(query: str) -> list[str]:
    """Search the web — budget-controlled."""
    return [f"Result for '{query}'"]

@castor_tool(consumes="disk", cost_per_use=1.0,
             destructive=True, requires_hitl=True)
def delete_files(paths: list[str]) -> int:
    """Delete files — requires human approval."""
    return len(paths)

kernel = Castor(tools=[web_search, delete_files])

async def agent(proxy: SyscallProxy) -> str:
    results = await proxy.web_search(query="castor kernel")
    deleted = await proxy.delete_files(paths=["/tmp/old.log"])
    return f"Done! Cleaned {deleted} files."

cp = await kernel.run(agent, budgets={"api": 10.0, "disk": 5.0})
# Agent suspends at delete_files — human must approve first.`}</code>
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Home(): ReactNode {
  return (
    <Layout
      title="A Secure Microkernel for LLM Agents"
      description="Castor cages LLMs inside a deterministic execution engine with capability-based security, checkpoint/replay, and human-in-the-loop control.">
      <HomepageHeader />
      <main>
        <HomepageFeatures />
        <CodePreview />
      </main>
    </Layout>
  );
}
