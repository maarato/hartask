import { createHash } from 'node:crypto';

/**
 * A uuid derived from a name instead of drawn at random (RFC 4122 v5).
 *
 * Most rows are identified by an id nobody chose, so two machines creating
 * separate things stay separate. A shared context is the opposite: it is
 * addressed by a slug a person picked, and two machines both writing
 * "decisions" mean the same document, not two. Deriving the uuid from the name
 * makes that literally true — they arrive at the same identity without ever
 * having spoken — so the merge matches them like any other row and the unique
 * slug is never asked to hold two.
 *
 * The namespace is the project, so the same name in two projects sharing one
 * store stays two documents.
 */
export function uuidForName(namespace: string, name: string): string {
  const bytes = createHash('sha1')
    .update(Buffer.from(namespace.replace(/-/g, ''), 'hex'))
    .update(name, 'utf8')
    .digest();

  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant

  const hex = bytes.subarray(0, 16).toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32)
  ].join('-');
}
