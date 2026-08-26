'use client'

import Link from 'next/link'
import { useState } from 'react'
import { ArrowRight, ArrowUpRight, Menu, X } from 'lucide-react'
import { availabilityLabel, VAULTED_CHAINS, type VaultedChain } from '@/lib/vaulted/registry'
import { useSession } from '../session-provider'
import { VaultedLogo, VaultedWordmark } from './logo'
import { Reveal } from './reveal'
import { VaultMark, VaultVisual } from './vault-visual'

/**
 * The Vaulted marketing page.
 *
 * Everything factual on this page is derived rather than written down: the network section reads
 * the registry, so a chain claims escrow only when a deployment record exists for it. There are
 * deliberately no user counts, TVL figures, transaction totals or partner logos — none of those
 * numbers exist yet, and inventing them is exactly the kind of claim an escrow product cannot
 * afford to make. The figures that do appear are contract constants, which are true by
 * construction and checkable by anyone who reads the source.
 *
 * Structurally the page alternates dark and light bands, with the light ones inset as rounded
 * slabs. That rhythm carries the sectioning, which is why so little here is a card.
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
    <header className="sticky top-0 z-50 bg-[#08080a]/70 backdrop-blur-xl">
      <nav className="mx-auto flex h-[72px] max-w-[1500px] items-center justify-between px-5 sm:px-8">
        <Link href="/" className="transition-opacity hover:opacity-70">
          <VaultedWordmark />
        </Link>

        {/* Pill cluster, floated right. Uppercase micro-type keeps it out of the headline's way. */}
        <div className="hidden items-center gap-1 md:flex">
          {links.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-full px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:bg-white/[0.05] hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
        </div>

        <div className="hidden items-center gap-2 md:flex">
          <Link
            href={account ? '/jobs' : '/login'}
            className="rounded-full border border-white/12 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:border-white/25 hover:text-foreground"
          >
            {account ? 'Find work' : 'Sign in'}
          </Link>
          <Link
            href={account ? '/dashboard' : '/login'}
            className="rounded-full px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#08080a] transition-opacity hover:opacity-90"
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
        <div className="border-t border-white/8 px-5 py-4 md:hidden">
          <div className="flex flex-col gap-1">
            {links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-2 py-3 text-[13px] font-semibold uppercase tracking-[0.14em] text-muted-foreground hover:bg-white/[0.05] hover:text-foreground"
              >
                {link.label}
              </a>
            ))}
            <Link href="/jobs" className="rounded-lg px-2 py-3 text-[13px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Find work
            </Link>
            <Link
              href="/dashboard"
              className="mt-2 rounded-full px-4 py-3 text-center text-[12px] font-semibold uppercase tracking-[0.14em] text-[#08080a]"
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

/*
  The headline is set as three lines with the break points chosen rather than left to the browser,
  because at this size the break *is* the composition. "TRUST LAYER" carries the accent: it is the
  claim the whole product rests on, so it is the one phrase that gets colour.
*/
function Hero() {
  return (
    <section className="vt-hero-glow relative overflow-hidden">
      <div className="vt-grid-fine vt-fade-b pointer-events-none absolute inset-0" aria-hidden />

      <div className="relative mx-auto max-w-[1500px] px-5 pb-16 pt-10 sm:px-8 sm:pt-12 lg:pb-20 lg:pt-14">
        <div className="relative">
          {/*
            The vault sits behind and to the right of the type, bled off the edge.

            Held clear of the headline's measure rather than layered over it: an overlap that lands
            a letterform on the keyhole reads as a collision, not as depth.
          */}
          <div
            className="pointer-events-none absolute -right-[26%] -top-[10%] w-[80%] opacity-40 sm:-right-[16%] sm:opacity-50 lg:-right-[1%] lg:top-[-14%] lg:w-[42%] lg:opacity-90"
            aria-hidden
          >
            <VaultVisual className="h-auto w-full" />
          </div>

          <div className="relative">
            <Reveal>
              <span className="vt-marker text-muted-foreground">Programmable on-chain escrow</span>
            </Reveal>

            <Reveal delay={70}>
              <h1 className="vt-editorial vt-display-xl mt-6 uppercase lg:max-w-[13ch]">
                The
                <br />
                <span className="vt-accent-text">Trust Layer</span>
                <br />
                For Web3 Work
              </h1>
            </Reveal>

            {/*
              Aligned to the top, not the bottom.

              Bottom-aligning these two columns pushed the paragraph and the buttons down to meet
              the taller panel, which put the only two calls to action on the page below the fold
              on a laptop. The panel is free to run on past them.
            */}
            <div className="mt-10 grid gap-10 lg:mt-12 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
              <div>
                <Reveal delay={140}>
                  <p className="max-w-md text-[15.5px] leading-relaxed text-muted-foreground">
                    Hire people. Secure the money. Get the work done. Escrow for freelancers,
                    creators, sponsors, developers and Web3 teams.
                  </p>
                </Reveal>

                <Reveal delay={200}>
                  <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                    <Link
                      href="/dashboard"
                      className="group inline-flex h-14 items-center justify-center gap-2.5 rounded-full px-8 text-[13px] font-semibold uppercase tracking-[0.12em] text-[#08080a] transition-transform hover:-translate-y-0.5"
                      style={{ background: 'var(--vt-accent)' }}
                    >
                      Create a Vault
                      <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
                    </Link>
                    <Link
                      href="/jobs"
                      className="inline-flex h-14 items-center justify-center rounded-full border border-white/14 px-8 text-[13px] font-semibold uppercase tracking-[0.12em] transition-colors hover:border-white/30 hover:bg-white/[0.04]"
                    >
                      Find Work
                    </Link>
                  </div>
                </Reveal>
              </div>

              {/* Floating panel, overlapping the vault. The three guarantees, as an object. */}
              <Reveal delay={260}>
                <div className="vt-panel w-full max-w-sm p-6 lg:w-[330px]">
                  <VaultMark size={26} className="text-[var(--vt-accent)]" />
                  <p className="mt-5 text-[14px] font-semibold">What the contract guarantees</p>
                  <ul className="mt-4 flex flex-col">
                    {[
                      ['Non-custodial', 'We hold no keys, and no withdrawal path exists.'],
                      ['On-chain escrow', 'A contract holds the money, not a company.'],
                      ['24h auto-release', 'The default window, after which anyone can settle it.'],
                    ].map(([label, body], index) => (
                      <li key={label}>
                        {index > 0 && <div className="vt-hairline my-3.5" />}
                        <p className="text-[12.5px] font-medium">{label}</p>
                        <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">{body}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

/* -------------------------------------------------- work without trust */

/*
  The problem, told as a sentence rather than as four boxes. The failure modes are set in the
  dimmed weight and the remedy in full ink, so the eye reads the argument before it reads the
  detail — which is the whole point the section is making.
*/
function TrustProblem() {
  const rows = [
    ['Invoice sent. Then silence.', 'Funds are locked before you start.'],
    ['Half up front, and hope for the rest.', 'The whole amount sits in escrow from day one.'],
    ['A platform holds your money and takes a cut.', 'A contract holds it. Nobody can withdraw it but you two.'],
    ['Chasing a client who has stopped replying.', 'If they go quiet, the escrow settles to you on its own.'],
  ]

  return (
    <LightBand id="problem">
      <div className="grid gap-10 lg:grid-cols-[auto_minmax(0,1fr)] lg:gap-16">
        <Reveal>
          <span className="vt-marker vt-muted-on-light lg:sticky lg:top-28">The problem</span>
        </Reveal>

        <div>
          <Reveal>
            <h2 className="vt-editorial vt-display-lg max-w-[16ch]">
              Work <span className="vt-dim">without the</span> trust problem
            </h2>
          </Reveal>

          <Reveal delay={80}>
            <p className="vt-muted-on-light mt-8 max-w-lg text-[15px] leading-relaxed">
              Getting paid for online work still runs on hope. Vaulted replaces the hoping with a
              contract that both sides can read.
            </p>
          </Reveal>

          <ul className="mt-14">
            {rows.map(([before, after], index) => (
              <Reveal key={before} as="li" delay={index * 60}>
                <div className="vt-hairline" />
                <div className="grid gap-2 py-7 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] sm:gap-10">
                  <p className="vt-dim text-[15px] leading-snug line-through decoration-1">{before}</p>
                  <p className="text-[16.5px] font-medium leading-snug">{after}</p>
                </div>
              </Reveal>
            ))}
            <div className="vt-hairline" />
          </ul>
        </div>
      </div>
    </LightBand>
  )
}

/* ---------------------------------------------------------- how it works */

/*
  The lifecycle, drawn as one continuous run rather than four cards. The rail is a real line the
  numbers sit on, so the page shows a process with an order instead of a set of features.
*/
function HowItWorks() {
  const steps = [
    ['Create', 'Set the amount, the work and the protection window. You get a link to share.'],
    ['Fund', 'Your client deposits into the escrow contract. Not into your wallet, and not into ours.'],
    ['Deliver', 'Do the work. The money is already secured and neither side can move it alone.'],
    ['Release', 'The client releases early, or the window closes and anyone can settle it to you.'],
  ]

  return (
    <DarkBand id="how">
      <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Reveal>
            <span className="vt-marker text-muted-foreground">How it works</span>
          </Reveal>
          <Reveal delay={60}>
            <h2 className="vt-editorial vt-display-lg mt-6 max-w-[12ch]">
              Four steps, <span className="vt-dim">one</span> contract
            </h2>
          </Reveal>
        </div>
        <Reveal delay={120}>
          <p className="max-w-xs text-[13px] leading-relaxed text-muted-foreground">
            One escrow, from published terms to settled funds. Every state below is a state the
            contract itself has.
          </p>
        </Reveal>
      </div>

      <ol className="relative mt-20 grid gap-y-14 md:grid-cols-4 md:gap-x-8">
        {/* The rail the whole lifecycle runs along. */}
        <div
          className="pointer-events-none absolute left-0 right-0 top-[7px] hidden h-px md:block"
          style={{
            background:
              'linear-gradient(90deg, rgba(255,138,0,0.55), rgba(255,255,255,0.14) 45%, rgba(255,255,255,0.14) 55%, rgba(255,138,0,0.55))',
          }}
          aria-hidden
        />
        {steps.map(([title, body], index) => (
          <Reveal key={title} as="li" delay={index * 90}>
            <div className="relative">
              <span
                className="relative z-10 block size-[15px] rounded-full border-2"
                style={{
                  borderColor: 'var(--vt-accent)',
                  background: '#08080a',
                }}
                aria-hidden
              />
              <p className="vt-numeric mt-7 text-[11px] font-semibold tracking-[0.2em] text-muted-foreground/60">
                {String(index + 1).padStart(2, '0')}
              </p>
              <h3 className="vt-editorial mt-3 text-[26px] uppercase leading-none">{title}</h3>
              <p className="mt-4 max-w-[30ch] text-[13.5px] leading-relaxed text-muted-foreground">{body}</p>
            </div>
          </Reveal>
        ))}
      </ol>
    </DarkBand>
  )
}

/* ------------------------------------------------------------- use cases */

/*
  Set as one continuous list with the headline built into it, so the categories read as an
  enumeration in a sentence rather than six equivalent tiles.
*/
function UseCases() {
  const cases = [
    ['Freelancers', 'Design, writing, editing — paid without a deposit argument.'],
    ['Developers', 'Contract work and audits, with the budget secured before the first commit.'],
    ['Influencers', 'Sponsored posts where the fee is locked before the campaign runs.'],
    ['Creators', 'Commissions and collaborations, settled without an intermediary.'],
    ['Community managers', 'Recurring contributor payments a DAO can verify on chain.'],
    ['Agencies', 'Milestone budgets held in escrow, one vault per deliverable.'],
  ]

  return (
    <LightBand id="use-cases">
      <Reveal>
        <span className="vt-marker vt-muted-on-light">Who it is for</span>
      </Reveal>

      <Reveal delay={60}>
        <h2 className="vt-editorial vt-display-lg mt-7 max-w-[15ch] uppercase">
          Built for people who <span className="vt-dim">get paid to</span> create
        </h2>
      </Reveal>

      <Reveal delay={120}>
        <p className="vt-muted-on-light mt-8 max-w-lg text-[15px] leading-relaxed">
          One primitive — money held by a contract until the work lands — covers a surprising amount
          of online work.
        </p>
      </Reveal>

      <div className="mt-16 grid gap-x-12 gap-y-0 md:grid-cols-2">
        {cases.map(([title, body], index) => (
          <Reveal key={title} delay={(index % 2) * 70}>
            <div className="group">
              <div className="vt-hairline" />
              <div className="flex items-baseline gap-5 py-7">
                <span className="vt-numeric text-[11px] font-semibold tracking-[0.2em] text-black/25">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <div className="min-w-0">
                  <h3 className="vt-editorial text-[27px] uppercase leading-none">{title}</h3>
                  <p className="vt-muted-on-light mt-3 text-[13.5px] leading-relaxed">{body}</p>
                </div>
              </div>
            </div>
          </Reveal>
        ))}
        <div className="vt-hairline md:col-span-2" />
      </div>
    </LightBand>
  )
}

/* ----------------------------------------------------------- funded jobs */

/*
  The job, presented as the financial object it is. The amount is the largest thing on it, because
  the amount being already secured is the entire pitch.

  The listing is illustrative and says so — this is a marketing page with no session, so it has no
  real listing to read. The disclosure stays: a page about escrow must not show a made-up secured
  budget without labelling it.
*/
function FundedJobs() {
  return (
    <DarkBand id="jobs">
      <div className="grid items-center gap-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)] lg:gap-20">
        <div>
          <Reveal>
            <span className="vt-marker text-muted-foreground">Funded jobs</span>
          </Reveal>
          <Reveal delay={60}>
            <h2 className="vt-editorial vt-display-lg mt-6 max-w-[14ch]">
              Post work with the money <span className="vt-dim">already</span> behind it
            </h2>
          </Reveal>
          <Reveal delay={120}>
            <p className="mt-8 max-w-md text-[15px] leading-relaxed text-muted-foreground">
              A job on Vaulted carries its budget. Freelancers can see the payment is secured before
              they write a single line — and clients get applicants who know the money is real.
            </p>
          </Reveal>
          <Reveal delay={180}>
            <Link
              href="/jobs"
              className="group mt-10 inline-flex items-center gap-2 text-[12px] font-semibold uppercase tracking-[0.14em]"
              style={{ color: 'var(--vt-accent)' }}
            >
              Browse open jobs
              <ArrowUpRight size={15} className="transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </Link>
          </Reveal>
        </div>

        <Reveal delay={100}>
          <div className="vt-panel relative overflow-hidden p-8 sm:p-10">
            <div className="vt-grid-fine pointer-events-none absolute inset-0 opacity-40" aria-hidden />
            <div className="relative">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <span className="vt-marker text-muted-foreground">Job</span>
                  <h3 className="vt-editorial mt-4 text-[30px] uppercase leading-none">Build Landing Page</h3>
                </div>
                <span
                  className="shrink-0 rounded-full px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.16em]"
                  style={{ background: 'var(--vt-accent-dim)', color: 'var(--vt-accent)' }}
                >
                  Secured
                </span>
              </div>

              {/* The amount, and the fact that it is already locked. */}
              <div className="vt-sweep relative mt-9 overflow-hidden">
                <p className="vt-numeric vt-editorial text-[clamp(2.6rem,7vw,3.9rem)] leading-none">
                  500<span className="ml-3 text-[0.36em] tracking-[0.1em] text-muted-foreground">USDC</span>
                </p>
              </div>
              <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Held by the contract
              </p>

              <div className="mt-9 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-white/8 bg-white/8">
                {[
                  ['Network', 'Base'],
                  ['Deadline', 'September 2'],
                ].map(([label, value]) => (
                  <div key={label} className="bg-[#0d0d11] p-4">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
                    <p className="mt-2 text-[15px] font-medium">{value}</p>
                  </div>
                ))}
              </div>

              <div className="mt-6 rounded-full border border-white/12 px-4 py-3.5 text-center text-[12px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Apply
              </div>
              <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground/70">
                Illustrative. Real listings show their escrow state read from the chain.
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </DarkBand>
  )
}

/* ----------------------------------------------------------- multi-chain */

/*
  Read straight from the registry, so this section cannot advertise a chain we have not deployed
  to, and cannot describe a network's abilities as anything other than what it actually has.
*/
function MultiChain() {
  const chains = VAULTED_CHAINS
  const live = chains.filter((chain) => chain.availability === 'live')

  return (
    <LightBand id="chains">
      <div className="grid gap-10 lg:grid-cols-[auto_minmax(0,1fr)] lg:gap-16">
        <Reveal>
          <span className="vt-marker vt-muted-on-light lg:sticky lg:top-28">Networks</span>
        </Reveal>

        <div>
          <Reveal>
            <h2 className="vt-editorial vt-display-lg max-w-[14ch] uppercase">
              Built to be <span className="vt-dim">multi</span>-chain
            </h2>
          </Reveal>
          <Reveal delay={80}>
            <p className="vt-muted-on-light mt-8 max-w-xl text-[15px] leading-relaxed">
              Vaulted separates the product from the chain it settles on. Payment links settle
              wherever a token is configured; escrow needs a Vaulted contract deployed to that
              network, so a network can take payments before it can hold a budget. Each row says
              which.
            </p>
          </Reveal>

          {/* An architecture, not a card grid: one origin branching to each network. */}
          <div className="mt-16">
            <Reveal>
              <div className="flex items-center gap-4">
                <VaultMark size={30} className="text-black" />
                <span className="vt-editorial text-[19px] uppercase tracking-[-0.02em]">Vaulted</span>
              </div>
            </Reveal>

            <div className="mt-2 pl-[14px]">
              {chains.map((chain, index) => (
                <Reveal key={chain.key} delay={index * 80}>
                  <ChainRow chain={chain} last={index === chains.length - 1} />
                </Reveal>
              ))}
            </div>
          </div>

          <Reveal delay={120}>
            <p className="vt-muted-on-light mt-10 text-[12.5px] leading-relaxed">
              {live.length > 0
                ? `${live.length} network${live.length === 1 ? '' : 's'} can hold an escrow today. Everything else is listed as what it is, not as available.`
                : 'Payment links settle today. No network can hold an escrow yet — that needs the Vaulted contract deployed, and each row says so.'}
            </p>
          </Reveal>
        </div>
      </div>
    </LightBand>
  )
}

function ChainRow({ chain, last }: { chain: VaultedChain; last: boolean }) {
  const isLive = chain.availability === 'live'
  return (
    <div className="relative flex items-stretch">
      {/* Branch line from the origin down to this network. */}
      <div className="relative w-12 shrink-0" aria-hidden>
        <span
          className="absolute left-0 top-0 w-px bg-black/15"
          style={{ height: last ? '50%' : '100%' }}
        />
        <span className="absolute left-0 top-1/2 h-px w-8 bg-black/15" />
      </div>

      <div className="flex flex-1 flex-wrap items-center justify-between gap-3 border-b border-black/10 py-6">
        <div className="flex items-center gap-3.5">
          <span
            className="size-2 rounded-full"
            style={{
              background: isLive ? 'var(--vt-accent)' : 'rgba(10,10,12,0.28)',
              boxShadow: isLive ? '0 0 0 4px rgba(255,138,0,0.16)' : undefined,
            }}
          />
          <span className="vt-editorial text-[24px] uppercase leading-none">{chain.shortName}</span>
        </div>

        <span
          className="rounded-full px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em]"
          style={
            isLive
              ? { background: 'rgba(255,138,0,0.15)', color: '#8a4b00' }
              : { background: 'rgba(10,10,12,0.06)', color: 'rgba(10,10,12,0.5)' }
          }
        >
          {availabilityLabel(chain)}
        </span>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------- security */

/*
  The most emphatic band on the page, because it is the one making the strongest claim. The
  principles are set as a numbered run rather than icon cards: generic shields would undercut
  copy whose whole virtue is precision.

  The unaudited disclosure is part of the section, not a footnote hidden under it.
*/
function Security() {
  const points = [
    [
      'Non-custodial by construction',
      'Vaulted holds no keys and has no withdrawal path. Escrowed funds can only ever reach that escrow’s own payer or payee.',
    ],
    [
      'Your wallet, and who else is involved',
      'Signing in with X assigns your account a wallet whose key Privy splits between a secure enclave and your device. Vaulted holds no share of it — but Privy is a dependency for recovery, and you can export the key and leave at any time.',
    ],
    [
      'Permissionless timeout',
      'Once the protection window closes, anyone can trigger settlement to the freelancer. Getting paid never depends on the client cooperating — or on us.',
    ],
    [
      'Disputes, described honestly',
      'A dispute pauses settlement. Resolving one needs the arbiter configured at deployment, or one side conceding. Vaulted does not claim decentralised arbitration it does not have.',
    ],
    [
      'One settlement each',
      'Reentrancy protection, checks-effects-interactions on every payout, and per-escrow accounting that the contract’s own invariant tests cover.',
    ],
  ]

  return (
    <DarkBand id="security">
      <div className="vt-grid-fine vt-fade-b pointer-events-none absolute inset-0 opacity-70" aria-hidden />

      <div className="relative">
        <Reveal>
          <span className="vt-marker text-muted-foreground">Security</span>
        </Reveal>

        <Reveal delay={60}>
          <h2 className="vt-editorial vt-display-lg mt-7 max-w-[13ch] uppercase">
            The contract <span className="vt-dim">is the</span> product
          </h2>
        </Reveal>

        <Reveal delay={120}>
          <p className="mt-8 max-w-lg text-[15px] leading-relaxed text-muted-foreground">
            The interface is convenience. The guarantees live in the escrow contract, and they are
            deliberately narrow enough to state precisely.
          </p>
        </Reveal>

        <div className="mt-16 grid gap-x-16 md:grid-cols-2">
          <ol className="md:col-span-2">
            {points.map(([title, body], index) => (
              <Reveal key={title} as="li" delay={index * 60}>
                <div className="vt-hairline" />
                <div className="grid gap-3 py-8 md:grid-cols-[auto_minmax(0,20ch)_minmax(0,1fr)] md:gap-10">
                  <span className="vt-numeric text-[11px] font-semibold tracking-[0.2em] text-muted-foreground/50">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <h3 className="text-[16px] font-semibold leading-snug">{title}</h3>
                  <p className="text-[14px] leading-relaxed text-muted-foreground">{body}</p>
                </div>
              </Reveal>
            ))}
            <div className="vt-hairline" />
          </ol>
        </div>

        <Reveal delay={120}>
          <div
            className="mt-10 max-w-2xl rounded-xl border p-6"
            style={{ borderColor: 'rgba(251,191,36,0.28)', background: 'rgba(251,191,36,0.05)' }}
          >
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: 'var(--vt-warning)' }}>
              Unaudited
            </p>
            <p className="mt-3 text-[13.5px] leading-relaxed text-muted-foreground">
              The escrow contract is unaudited. It has a thorough test suite and a small surface, but
              no third party has reviewed it — worth knowing before you move real money through it.
            </p>
          </div>
        </Reveal>

        <Facts />
      </div>
    </DarkBand>
  )
}

/*
  Figures, without inventing any.

  A statistics band is the obvious place to put usage numbers, and Vaulted has none worth showing —
  so these are contract constants and registry facts instead. Every one is true by construction and
  checkable in the source, which is a better fit for this product than a total-value-locked counter
  would be even if there were one to print.
*/
function Facts() {
  const escrowChains = VAULTED_CHAINS.filter((chain) => chain.capabilities.escrow).length
  const payChains = VAULTED_CHAINS.filter((chain) => chain.capabilities.transfer).length

  const facts: [string, string, string][] = [
    ['Keys Vaulted holds', '0', 'No withdrawal path exists in the contract.'],
    ['Default protection window', '24h', 'Configurable from 1 hour to 365 days.'],
    ['Networks holding escrow', String(escrowChains), `${payChains} can settle payment links.`],
    ['Settlements per escrow', '1', 'Terminal states are never reopened.'],
  ]

  return (
    <div className="mt-20 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {facts.map(([label, value, note], index) => (
        <Reveal key={label} delay={index * 70}>
          <div className="vt-panel h-full p-6">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
            <p className="vt-numeric vt-editorial mt-6 text-[clamp(2.4rem,5vw,3.2rem)] leading-none">{value}</p>
            <div className="vt-hairline my-5" />
            <p className="text-[11.5px] leading-relaxed text-muted-foreground">{note}</p>
          </div>
        </Reveal>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------- final cta */

function FinalCta() {
  return (
    <section id="start" className="relative mx-auto max-w-[1500px] scroll-mt-24 px-5 pb-24 sm:px-8">
      <Reveal>
        <div className="vt-hero-glow vt-slab relative overflow-hidden border border-white/10 px-6 py-20 text-center sm:px-12 sm:py-28">
          <div className="vt-grid-fine vt-fade-b pointer-events-none absolute inset-0" aria-hidden />
          <div className="relative">
            <VaultedLogo size={40} className="mx-auto" />
            <h2 className="vt-editorial vt-display-md mx-auto mt-10 max-w-[16ch] uppercase">
              Secure the money. <span className="vt-dim">Then</span> do the work.
            </h2>
            <p className="mx-auto mt-7 max-w-md text-[15px] leading-relaxed text-muted-foreground">
              Create a vault in a couple of minutes. Your client funds a contract, not your invoice.
            </p>
            <div className="mt-10 flex flex-col justify-center gap-3 sm:flex-row">
              <Link
                href="/dashboard"
                className="group inline-flex h-14 items-center justify-center gap-2.5 rounded-full px-8 text-[13px] font-semibold uppercase tracking-[0.12em] text-[#08080a] transition-transform hover:-translate-y-0.5"
                style={{ background: 'var(--vt-accent)' }}
              >
                Create a Vault
                <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" />
              </Link>
              <Link
                href="/jobs"
                className="inline-flex h-14 items-center justify-center rounded-full border border-white/14 px-8 text-[13px] font-semibold uppercase tracking-[0.12em] transition-colors hover:border-white/30 hover:bg-white/[0.04]"
              >
                Find Work
              </Link>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  )
}

/* ---------------------------------------------------------------- footer */

function Footer() {
  return (
    <footer className="border-t border-white/8">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-10 px-5 py-16 sm:px-8 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-xs">
          <VaultedWordmark />
          <p className="mt-4 text-[13px] leading-relaxed text-muted-foreground">
            Programmable on-chain escrow for Web3 work. Non-custodial, and deliberately boring about
            what it promises.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-10 sm:gap-16">
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

      <div className="mx-auto max-w-[1500px] px-5 pb-12 sm:px-8">
        <div className="vt-hairline" />
        <div className="flex flex-col gap-2 pt-7 text-[11.5px] uppercase tracking-[0.12em] text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>Vaulted — escrow for Web3 work</span>
          <span>Non-custodial · Unaudited contract</span>
        </div>
      </div>
    </footer>
  )
}

function FooterColumn({ title, links }: { title: string; links: { href: string; label: string }[] }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/60">{title}</p>
      <ul className="mt-4 flex flex-col gap-2.5">
        {links.map((link) => (
          <li key={link.label}>
            <Link href={link.href} className="text-[13.5px] text-muted-foreground transition-colors hover:text-foreground">
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ------------------------------------------------------------- primitives */

/*
  The two bands the page alternates between.

  A light band is inset as a rounded slab sitting on the dark page rather than running edge to
  edge. That single device does most of the sectioning work, which is why almost nothing inside
  either band needs a border of its own.
*/
function DarkBand({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <section
      id={id}
      className="relative mx-auto max-w-[1500px] scroll-mt-24 overflow-hidden px-5 py-24 sm:px-8 sm:py-32"
    >
      {children}
    </section>
  )
}

function LightBand({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <div className="px-2 sm:px-4">
      <section
        id={id}
        className="vt-light vt-slab relative mx-auto max-w-[1500px] scroll-mt-24 overflow-hidden px-6 py-24 sm:px-12 sm:py-32 lg:px-16"
      >
        {children}
      </section>
    </div>
  )
}
