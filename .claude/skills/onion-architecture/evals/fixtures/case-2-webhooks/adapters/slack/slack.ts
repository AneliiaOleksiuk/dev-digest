export interface SlackMessage {
  channel: string;
  text: string;
}

export class SlackNotifier {
  constructor(private webhookUrl: string) {}

  async send(message: SlackMessage): Promise<void> {
    await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(message),
    });
  }
}
