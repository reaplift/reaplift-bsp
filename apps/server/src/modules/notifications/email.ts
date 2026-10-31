import { createTransport } from 'nodemailer';
import type { Logger } from '../../lib/logger.js';

export interface Email {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Sends one email or throws. The delivery loop decides about retries. */
export interface EmailProvider {
  send(email: Email): Promise<void>;
}

/** Writes emails to the log and keeps them for tests. `fail` makes every send throw (demo of retries). */
export class FakeEmailProvider implements EmailProvider {
  readonly sent: Email[] = [];
  constructor(
    private readonly log?: Logger,
    public fail: string | null = null,
  ) {}

  async send(email: Email) {
    if (this.fail) throw new Error(this.fail);
    this.sent.push(email);
    this.log?.info({ email }, 'fake email provider: email "sent"');
  }
}

export interface SmtpSettings {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
}

/** OCI Email Delivery (or any SMTP relay) with STARTTLS. */
export class SmtpEmailProvider implements EmailProvider {
  private readonly transport;
  constructor(private readonly settings: SmtpSettings) {
    this.transport = createTransport({
      host: settings.host,
      port: settings.port,
      secure: settings.port === 465,
      requireTLS: settings.port !== 465,
      auth: { user: settings.user, pass: settings.password },
      connectionTimeout: 15_000,
      socketTimeout: 30_000,
    });
  }

  async send(email: Email) {
    await this.transport.sendMail({ from: this.settings.from, ...email });
  }
}
