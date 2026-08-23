'use client'

import Link from 'next/link'
import { useState } from 'react'
import {
  ArrowRight,
  Braces,
  Building2,
  CircleDot,
  Clock,
  FileCheck2,
  Gavel,
  Handshake,
  KeyRound,
  Layers,
  Menu,
  Megaphone,
  PenTool,
  ShieldCheck,
  Sparkles,
  Users,
  Wallet,
  X,
} from 'lucide-react'
import { availabilityLabel, VAULTED_CHAINS, type VaultedChain } from '@/lib/vaulted/registry'
import { useSession } from '../session-provider'
import { EscrowFlow } from './escrow-flow'
import { VaultedLogo, VaultedWordmark } from './logo'
import { Reveal } from './reveal'

/**
 * The Vaulted marketing page.
 *
 * Everything factual on this page is derived rather than written down: the chain grid reads the
 * registry, so a chain shows "Live" only when a deployment record exists. There are deliberately no
 * user counts, TVL figures, transaction totals or partner logos — none of those numbers exist yet,
 * and inventing them is exactly the kind of claim an escrow product cannot afford to make.
 */
export function Landing() {
  return (
    <div className="vt-dark vt-noise relative min-h-screen overflow-x-hidden">
      {/*
        The reveal animation hides content until it scrolls into view. Without JavaScript nothing
        would ever un-hide it, so the page would render blank — this makes the content
        unconditionally visible in that case.
      */}
      <noscript>
        <style>{`.vt-reveal { opacity: 1 !important; transform: none !important; }`}</style>
      </noscript>
      <Nav />
      <Hero />
      <TrustProblem />
      <HowItWorks />
      <UseCases />
      <FundedJobs />
      <MultiChain />
      <Security />
      <FinalCta />
      <Footer />
    </div>
  )
}

/* ------------------------------------------------------------------ nav */

function Nav() {
  const [open, setOpen] = useState(false)
  const { account } = useSession()
  const links = [
    { href: '#how', label: 'How it works' },
    { href: '#use-cases', label: 'Use cases' },
    { href: '#chains', label: 'Networks' },
    { href: '#security', label: 'Security' },
  ]

  return (
    <header className="sticky top-0 z-50 border-b border-border/70 bg-[#08080a]/80 backdrop-blur-xl">
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <Link href="/" className="transition-opacity hover:opacity-80">
          <VaultedWordmark />
        </Link>

        <div className="hidden items-center gap-7 md:flex">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-[13.5px] text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="hidden items-center gap-3 md:flex">
          <Link
            href={account ? '/jobs' : '/login'}
            className="text-[13.5px] text-muted-foreground transition-colors hover:text-foreground"
          >
            {account ? 'Find work' : 'Sign in'}
          </Link>
          <Link
            href={account ? '/dashboard' : '/login'}
            className="rounded-xl px-4 py-2 text-[13.5px] font-medium text-[#08080a] transition-opacity hover:opacity-90"
            style={{ background: 'var(--vt-accent)' }}
          >
            {account ? 'Dashboard' : 'Create a Vault'}
          </Link>
        </div>

        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="rounded-lg p-2 text-muted-foreground md:hidden"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
        >
          {open ? <X size={18} /> : <Menu size={18} />}
        </button>
      </nav>

      {open && (
        <div className="border-t border-border/70 px-5 py-4 md:hidden">
          <div className="flex flex-col gap-1">
            {links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-2 py-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {link.label}
              </a>
            ))}
            <Link href="/jobs" className="rounded-lg px-2 py-2.5 text-sm text-muted-foreground hover:bg-muted">
              Find work
            </Link>
            <Link
              href="/dashboard"
              className="mt-2 rounded-xl px-4 py-3 text-center text-sm font-medium text-[#08080a]"
              style={{ background: 'var(--vt-accent)' }}
            >
              Create a Vault
            </Link>
          </div>
        </div>
      )}
    </header>
  )
}

/* ----------------------------------------------------------------- hero */

function Hero() {
  return (
    <section className="vt-hero-glow relative overflow-hidden">
      <div className="vt-grid pointer-events-none absolute inset-0" aria-hidden />
      <div className="relative mx-auto max-w-6xl px-5 pb-20 pt-16 sm:pt-24 lg:pb-28">
        <div className="grid items-center gap-14 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
          <div>
            <Reveal>
              <span
                className="vt-eyebrow inline-flex items-center gap-2 rounded-full border px-3 py-1.5"
                style={{ borderColor: 'rgba(255,138,0,0.3)', color: 'var(--vt-accent)' }}
              >
                <CircleDot size={11} />
                Vaulted
              </span>
            </Reveal>

            <Reveal delay={60}>
              <h1 className="vt-display mt-6 text-[clamp(2.5rem,6.2vw,4.4rem)] leading-[1.03]">
                The trust layer
                <br />
                for <span className="vt-accent-text">Web3 work</span>.
              </h1>
            </Reveal>

            <Reveal delay={120}>
              <p className="mt-6 max-w-xl text-[16.5px] leading-relaxed text-muted-foreground">
                Hire people. Secure the money. Get the work done. Programmable on-chain escrow for
                freelancers, creators, sponsors, developers and Web3 teams.
              </p>
            </Reveal>

            <Reveal delay={180}>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/dashboard"
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-xl px-6 text-[15px] font-semibold text-[#08080a] transition-transform hover:-translate-y-0.5"
                  style={{ background: 'var(--vt-accent)' }}
                >
                  Create a Vault
                  <ArrowRight size={17} />
                </Link>
                <Link
                  href="/jobs"
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-border px-6 text-[15px] font-medium transition-colors hover:bg-muted"
                >
                  Find Work
                </Link>
              </div>
            </Reveal>

            <Reveal delay={240}>
              <ul className="mt-9 flex flex-wrap gap-x-6 gap-y-3">
                {[
                  { icon: Wallet, label: 'Non-custodial' },
                  { icon: ShieldCheck, label: 'On-chain escrow' },
                  { icon: Clock, label: '24h auto-release' },
                ].map(({ icon: Icon, label }) => (
                  <li key={label} className="flex items-center gap-2 text-[13px] text-muted-foreground">
                    <Icon size={14} style={{ color: 'var(--vt-accent)' }} />
                    {label}
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>

          <Reveal delay={140}>
            <EscrowFlow />
          </Reveal>
        </div>
      </div>
    </section>
  )
}

/* -------------------------------------------------- work without trust */

function TrustProblem() {
  const rows = [
    {
      before: 'Invoice sent. Then silence.',
      after: 'Funds are locked before you start.',
    },
    {
      before: 'Half up front, and hope for the rest.',
      after: 'The whole amount sits in escrow from day one.',
    },
    {
      before: 'A platform holds your money and takes a cut.',
      after: 'A contract holds it. Nobody can withdraw it but you two.',
    },
    {
      before: 'Chasing a client who has stopped replying.',
      after: 'If they go quiet, the escrow settles to you on its own.',
    },
  ]

  return (
    <Section id="problem">
      <SectionHeading
        eyebrow="The problem"
        title="Work without the trust problem"
        body="Getting paid for online work still runs on hope. Vaulted replaces the hoping with a contract that both sides can read."
      />

      <div className="mt-12 grid gap-3 sm:gap-4 md:grid-cols-2">
        {rows.map((row, index) => (
          <Reveal key={row.before} delay={index * 70}>
            <div className="h-full rounded-2xl border border-border bg-card p-6">
              <p className="text-[14px] leading-relaxed text-muted-foreground line-through decoration-white/20">
                {row.before}
              </p>
              <div className="my-4 vt-rule" />
              <p className="text-[15px] font-medium leading-relaxed">{row.after}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  )
}

/* ---------------------------------------------------------- how it works */

function HowItWorks() {
  const steps = [
    {
      icon: PenTool,
      title: 'Create',
      body: 'Set the amount, the work and the protection window. You get a link to share.',
    },
    {
      icon: Wallet,
      title: 'Fund',
      body: 'Your client deposits stablecoins into the escrow contract. Not into your wallet, and not into ours.',
    },
    {
      icon: FileCheck2,
      title: 'Deliver',
      body: 'Do the work. The money is already secured and neither side can move it alone.',
    },
    {
      icon: Sparkles,
      title: 'Release',
      body: 'The client releases early, or the protection window closes and anyone can settle it to you.',
    },
  ]

  return (
    <Section id="how">
      <SectionHeading eyebrow="How it works" title="Four steps, one contract" />

      <ol className="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {steps.map((step, index) => (
          <Reveal key={step.title} as="li" delay={index * 80}>
            <div className="relative h-full rounded-2xl border border-border bg-card p-6">
              <div className="flex items-center justify-between">
                <span
                  className="flex size-9 items-center justify-center rounded-xl"
                  style={{ background: 'var(--vt-accent-dim)', color: 'var(--vt-accent)' }}
                >
                  <step.icon size={17} />
                </span>
                <span className="vt-numeric text-[13px] text-muted-foreground/50">0{index + 1}</span>
              </div>
              <h3 className="mt-5 text-[17px] font-semibold">{step.title}</h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">{step.body}</p>
            </div>
          </Reveal>
        ))}
      </ol>
    </Section>
  )
}

/* ------------------------------------------------------------- use cases */

function UseCases() {
  const cases = [
    { icon: PenTool, title: 'Freelancers', body: 'Design, writing, editing — paid without a deposit argument.' },
    { icon: Braces, title: 'Developers', body: 'Contract work and audits, with the budget secured before the first commit.' },
    { icon: Megaphone, title: 'Influencers', body: 'Sponsored posts where the fee is locked before the campaign runs.' },
    { icon: Sparkles, title: 'Creators', body: 'Commissions and collaborations, settled without an intermediary.' },
    { icon: Users, title: 'Community managers', body: 'Recurring contributor payments a DAO can verify on chain.' },
    { icon: Building2, title: 'Agencies', body: 'Milestone budgets held in escrow, one vault per deliverable.' },
  ]

  return (
    <Section id="use-cases">
      <SectionHeading
        eyebrow="Who it is for"
        title="Anyone who gets paid to make something"
        body="One primitive — money held by a contract until the work lands — covers a surprising amount of online work."
      />

      <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {cases.map((useCase, index) => (
          <Reveal key={useCase.title} delay={(index % 3) * 70}>
            <div className="group h-full rounded-2xl border border-border bg-card p-6 transition-colors hover:border-[rgba(255,138,0,0.35)]">
              <useCase.icon size={19} style={{ color: 'var(--vt-accent)' }} />
              <h3 className="mt-4 text-[16px] font-semibold">{useCase.title}</h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">{useCase.body}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  )
}

/* ----------------------------------------------------------- funded jobs */

function FundedJobs() {
  return (
    <Section id="jobs">
      <div className="grid items-center gap-12 lg:grid-cols-2">
        <div>
          <SectionHeading
            align="left"
            eyebrow="Funded jobs"
            title="Post work with the money already behind it"
            body="A job on Vaulted carries its budget. Freelancers can see the payment is secured before they write a single line — and clients get applicants who know the money is real."
          />
          <Reveal delay={140}>
            <Link
              href="/jobs"
              className="mt-8 inline-flex items-center gap-2 text-[14px] font-medium"
              style={{ color: 'var(--vt-accent)' }}
            >
              Browse open jobs
              <ArrowRight size={15} />
            </Link>
          </Reveal>
        </div>

        <Reveal delay={100}>
          <div className="vt-glass rounded-2xl p-6">
            <p className="vt-eyebrow text-muted-foreground">Job</p>
            <h3 className="mt-3 text-[20px] font-semibold tracking-[-0.02em]">Build Landing Page</h3>

            <dl className="mt-5 space-y-3 text-[13.5px]">
              <Row label="Budget" value="500 USDC" />
              <Row label="Network" value="Base" />
              <Row label="Deadline" value="September 2" />
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Payment</dt>
                <dd
                  className="vt-eyebrow rounded-full px-2.5 py-1"
                  style={{ background: 'var(--vt-accent-dim)', color: 'var(--vt-accent)' }}
                >
                  Secured
                </dd>
              </div>
            </dl>

            <div className="mt-6 rounded-xl border border-border px-4 py-3 text-center text-[13.5px] font-medium text-muted-foreground">
              Apply
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground/70">
              Illustrative. Real listings show their escrow state read from the chain.
            </p>
          </div>
        </Reveal>
      </div>
    </Section>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  )
}

/* ----------------------------------------------------------- multi-chain */

function MultiChain() {
  // Read straight from the registry, so this grid cannot advertise a chain we have not deployed to.
  const chains = VAULTED_CHAINS
  const live = chains.filter((chain) => chain.availability === 'live')

  return (
    <Section id="chains">
      <SectionHeading
        eyebrow="Networks"
        title="Built to be multi-chain"
        body="Vaulted separates the product from the chain it settles on, so each network gets its own escrow implementation behind one interface. Only networks with a deployed contract can take a payment — the rest say so."
      />

      <div className="mt-12 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {chains.map((chain, index) => (
          <Reveal key={chain.key} delay={(index % 3) * 60}>
            <ChainCard chain={chain} />
          </Reveal>
        ))}
      </div>

      <Reveal delay={120}>
        <p className="mt-6 text-[12.5px] text-muted-foreground">
          {live.length > 0
            ? `${live.length} network${live.length === 1 ? '' : 's'} live today. Everything else is listed as planned, not available.`
            : 'No network is live yet.'}
        </p>
      </Reveal>
    </Section>
  )
}

function ChainCard({ chain }: { chain: VaultedChain }) {
  const isLive = chain.availability === 'live'
  return (
    <div
      className="flex h-full items-start gap-3 rounded-2xl border p-5"
      style={{
        borderColor: isLive ? 'rgba(255,138,0,0.3)' : 'var(--border)',
        background: isLive ? 'var(--vt-accent-dim)' : 'var(--card)',
      }}
    >
      <span
        className="mt-1 size-2 shrink-0 rounded-full"
        style={{ background: isLive ? 'var(--vt-accent)' : 'var(--muted-foreground)', opacity: isLive ? 1 : 0.4 }}
      />
      <div className="min-w-0">
        <p className="text-[14.5px] font-semibold">{chain.shortName}</p>
        <p
          className="mt-0.5 text-[12px]"
          style={{ color: isLive ? 'var(--vt-accent)' : 'var(--muted-foreground)' }}
        >
          {availabilityLabel(chain)}
          {chain.family === 'svm' && ' · Devnet'}
        </p>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------- security */

function Security() {
  const points = [
    {
      icon: Wallet,
      title: 'Non-custodial by construction',
      body: 'Vaulted holds no keys and has no withdrawal path. Escrowed funds can only ever reach that escrow’s own payer or payee.',
    },
    {
      icon: KeyRound,
      title: 'Your wallet, and who else is involved',
      body: 'Signing in with X assigns your account a wallet whose key Privy splits between a secure enclave and your device. Vaulted holds no share of it — but Privy is a dependency for recovery, and you can export the key and leave at any time.',
    },
    {
      icon: Clock,
      title: 'Permissionless timeout',
      body: 'Once the protection window closes, anyone can trigger settlement to the freelancer. Getting paid never depends on the client cooperating — or on us.',
    },
    {
      icon: Gavel,
      title: 'Disputes, described honestly',
      body: 'A dispute pauses settlement. Resolving one needs the arbiter configured at deployment, or one side conceding. Vaulted does not claim decentralised arbitration it does not have.',
    },
    {
      icon: Layers,
      title: 'One settlement each',
      body: 'Reentrancy protection, checks-effects-interactions on every payout, and per-escrow accounting that the contract’s own invariant tests cover.',
    },
  ]

  return (
    <Section id="security">
      <SectionHeading
        eyebrow="Security"
        title="The contract is the product"
        body="The interface is convenience. The guarantees live in the escrow contract, and they are deliberately narrow enough to state precisely."
      />

      <div className="mt-12 grid gap-4 md:grid-cols-2">
        {points.map((point, index) => (
          <Reveal key={point.title} delay={(index % 2) * 80}>
            <div className="h-full rounded-2xl border border-border bg-card p-6">
              <point.icon size={19} style={{ color: 'var(--vt-accent)' }} />
              <h3 className="mt-4 text-[16px] font-semibold">{point.title}</h3>
              <p className="mt-2 text-[13.5px] leading-relaxed text-muted-foreground">{point.body}</p>
            </div>
          </Reveal>
        ))}
      </div>

      <Reveal delay={120}>
        <p className="mt-6 text-[12.5px] leading-relaxed text-muted-foreground">
          The escrow contract is unaudited. It has a thorough test suite and a small surface, but no
          third party has reviewed it — worth knowing before you move real money through it.
        </p>
      </Reveal>
    </Section>
  )
}

/* ------------------------------------------------------------- final cta */

function FinalCta() {
  return (
    <Section id="start">
      <Reveal>
        <div className="vt-hero-glow relative overflow-hidden rounded-3xl border border-border px-6 py-16 text-center sm:px-12">
          <div className="vt-grid pointer-events-none absolute inset-0" aria-hidden />
          <div className="relative">
            <VaultedLogo size={44} className="mx-auto" />
            <h2 className="vt-display mt-6 text-[clamp(1.9rem,4.4vw,3rem)] leading-[1.06]">
              Secure the money.
              <br />
              Then do the work.
            </h2>
            <p className="mx-auto mt-5 max-w-md text-[15px] leading-relaxed text-muted-foreground">
              Create a vault in a couple of minutes. Your client funds a contract, not your invoice.
            </p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Link
                href="/dashboard"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-xl px-6 text-[15px] font-semibold text-[#08080a] transition-transform hover:-translate-y-0.5"
                style={{ background: 'var(--vt-accent)' }}
              >
                Create a Vault
                <ArrowRight size={17} />
              </Link>
              <Link
                href="/jobs"
                className="inline-flex h-12 items-center justify-center rounded-xl border border-border px-6 text-[15px] font-medium transition-colors hover:bg-muted"
              >
                Find Work
              </Link>
            </div>
          </div>
        </div>
      </Reveal>
    </Section>
  )
}

/* ---------------------------------------------------------------- footer */

function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-5 py-12 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-xs">
          <VaultedWordmark />
          <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
            Programmable on-chain escrow for Web3 work. Non-custodial, and deliberately boring about
            what it promises.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-10 sm:gap-14">
          <FooterColumn
            title="Product"
            links={[
              { href: '/dashboard', label: 'Dashboard' },
              { href: '/jobs', label: 'Jobs' },
              { href: '#how', label: 'How it works' },
            ]}
          />
          <FooterColumn
            title="Learn"
            links={[
              { href: '#chains', label: 'Networks' },
              { href: '#security', label: 'Security' },
            ]}
          />
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-5 pb-10">
        <div className="vt-rule" />
        <div className="flex flex-col gap-2 pt-6 text-[12px] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>Vaulted — escrow for Web3 work.</span>
          <span className="flex items-center gap-1.5">
            <Handshake size={13} />
            Non-custodial. Unaudited contract.
          </span>
        </div>
      </div>
    </footer>
  )
}

function FooterColumn({ title, links }: { title: string; links: { href: string; label: string }[] }) {
  return (
    <div>
      <p className="vt-eyebrow text-muted-foreground">{title}</p>
      <ul className="mt-3 flex flex-col gap-2">
        {links.map((link) => (
          <li key={link.label}>
            <Link href={link.href} className="text-[13.5px] text-muted-foreground hover:text-foreground">
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ------------------------------------------------------------- primitives */

function Section({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mx-auto max-w-6xl scroll-mt-20 px-5 py-20 sm:py-24 lg:py-28">
      {children}
    </section>
  )
}

function SectionHeading({
  eyebrow,
  title,
  body,
  align = 'center',
}: {
  eyebrow: string
  title: string
  body?: string
  align?: 'center' | 'left'
}) {
  const alignment = align === 'center' ? 'mx-auto max-w-2xl text-center' : 'max-w-xl'
  return (
    <div className={alignment}>
      <Reveal>
        <p className="vt-eyebrow" style={{ color: 'var(--vt-accent)' }}>
          {eyebrow}
        </p>
      </Reveal>
      <Reveal delay={60}>
        <h2 className="vt-display mt-4 text-[clamp(1.8rem,4vw,2.7rem)] leading-[1.1]">{title}</h2>
      </Reveal>
      {body && (
        <Reveal delay={120}>
          <p className="mt-4 text-[15.5px] leading-relaxed text-muted-foreground">{body}</p>
        </Reveal>
      )}
    </div>
  )
}
