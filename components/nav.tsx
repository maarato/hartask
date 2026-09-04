'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/tasks', label: 'Tasks' },
  { href: '/summary', label: 'Summary' },
  { href: '/harness', label: 'Harness' }
] as const;

/**
 * The only client component in the app. A layout does not receive the current
 * pathname on the server, and keeping the nav in the layout means a new page
 * gets correct highlighting without having to remember to pass its own route.
 *
 * aria-current is both the accessibility signal and the styling hook, so the
 * active tab cannot look selected without being announced as selected.
 */
export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="tabs">
      {TABS.map(({ href, label }) => {
        // startsWith so a nested route such as /tasks/TASK-001 keeps its tab lit.
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link key={href} href={href} className="tab" aria-current={active ? 'page' : undefined}>
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
