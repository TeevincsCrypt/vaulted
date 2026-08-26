import type { Metadata, Viewport } from 'next'
import { Archivo } from 'next/font/google'
import './globals.css'
import { AuthProvider } from '@/components/vaulted/auth-provider'
import { SessionProvider } from '@/components/vaulted/session-provider'
import { Web3Provider } from '@/components/web3-provider'

export const metadata: Metadata = {
  title: 'Vaulted — escrowed payment links',
  description:
    'Share a payment link. Clients fund a smart contract, not your wallet, and the escrow settles to you when the protection window closes.',
}

/*
 * Display face for marketing headlines only — see `.vt-editorial`.
 *
 * Self-hosted by next/font at build time, so there is no request to a font CDN at runtime and no
 * new package in the dependency tree. Exposed as a variable rather than applied to `body`, so
 * running text everywhere still uses the system stack it was designed and checked against, and the
 * product UI is untouched by this.
 */
const display = Archivo({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-display',
  display: 'swap',
})

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#08080a',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={display.variable}>
      <body>
        <SessionProvider>
          <Web3Provider>
            <AuthProvider>{children}</AuthProvider>
          </Web3Provider>
        </SessionProvider>
      </body>
    </html>
  )
}
