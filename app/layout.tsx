import type { Metadata, Viewport } from 'next'
import './globals.css'
import { SessionProvider } from '@/components/vaulted/session-provider'
import { Web3Provider } from '@/components/web3-provider'

export const metadata: Metadata = {
  title: 'Vaulted — escrowed payment links',
  description:
    'Share a payment link. Clients fund a smart contract, not your wallet, and the escrow settles to you when the protection window closes.',
}

export const viewport: Viewport = {
  colorScheme: 'dark',
  themeColor: '#08080a',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>
          <Web3Provider>{children}</Web3Provider>
        </SessionProvider>
      </body>
    </html>
  )
}
