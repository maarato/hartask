import './globals.css';
import { Nav } from '@/components/nav';

export const metadata = {
  title: 'Hartask',
  description: 'Local project continuity and task control plane'
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <main>
          <Nav />
          {children}
        </main>
      </body>
    </html>
  );
}
