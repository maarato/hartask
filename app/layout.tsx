import './globals.css';
import Link from 'next/link';

export const metadata = { title: 'Hartask', description: 'Local project continuity and task control plane' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="es"><body><main>
    <nav>
      <Link href="/tasks">Tasks</Link>
      <Link href="/summary">Summary</Link>
      <Link href="/harness">Harness</Link>
    </nav>
    {children}
  </main></body></html>;
}
