import { renderDigestSummary } from '../../modules/digest/helpers.js';
import type { DigestMailer } from '../../modules/digest/ports.js';
import type { DigestItemRow } from '../../db/rows.js';

export class SendgridDigestMailer implements DigestMailer {
  constructor(private apiKey: string) {}

  async send(workspaceEmail: string, items: DigestItemRow[]): Promise<void> {
    const body = renderDigestSummary(items);
    await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ to: workspaceEmail, html: body }),
    });
  }
}
