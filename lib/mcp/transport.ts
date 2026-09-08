import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';

/**
 * MCP Streamable HTTP over a Next.js route handler.
 *
 * The SDK's own transport wants Node's IncomingMessage/ServerResponse, which
 * an App Router handler does not have — it gets a Web `Request`. This bridges
 * the gap at the smallest possible surface: the SDK still owns every protocol
 * decision, and this only carries one message in and one out.
 *
 * Stateless by design. Each POST is a complete exchange, so there is no session
 * to keep alive between requests and nothing to clean up if a client vanishes.
 * Server-initiated messages would need SSE and a session, which nothing here
 * asks for yet.
 */
export class SingleExchangeTransport implements Transport {
  onmessage?: (message: JSONRPCMessage) => void;
  onclose?: () => void;
  onerror?: (error: Error) => void;

  private settle!: (message: JSONRPCMessage | null) => void;
  private readonly answer = new Promise<JSONRPCMessage | null>((resolve) => {
    this.settle = resolve;
  });

  async start(): Promise<void> {}

  async send(message: JSONRPCMessage): Promise<void> {
    this.settle(message);
  }

  async close(): Promise<void> {
    this.onclose?.();
  }

  /**
   * Feeds one client message to the server and waits for its reply.
   *
   * A notification carries no id and gets no reply, so waiting on one would
   * hang the request forever. Those return immediately with nothing to send.
   */
  async exchange(message: JSONRPCMessage): Promise<JSONRPCMessage | null> {
    const isNotification = !('id' in message);
    this.onmessage?.(message);
    if (isNotification) return null;
    return this.answer;
  }
}
