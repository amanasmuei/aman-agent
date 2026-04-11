export interface InboxMessage {
  id: string;
  from: string; // sender agent name or "user"
  topic?: string;
  body: string;
  received_at: number;
}

export class Inbox {
  private queue: InboxMessage[] = [];
  private counter = 0;

  enqueue(msg: Omit<InboxMessage, "id" | "received_at">): InboxMessage {
    const full: InboxMessage = {
      ...msg,
      id: `inbox-${++this.counter}`,
      received_at: Date.now(),
    };
    this.queue.push(full);
    return full;
  }

  peek(): readonly InboxMessage[] {
    return [...this.queue];
  }

  drain(): InboxMessage[] {
    const out = this.queue;
    this.queue = [];
    return out;
  }

  get count(): number {
    return this.queue.length;
  }
}
