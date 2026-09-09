import nodemailer from "nodemailer";
import { config } from "./config.js";

const cfg = config.mail;

let transporter = null;
if (cfg.enabled && cfg.user && cfg.pass) {
  transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
  });
}

/**
 * Escape HTML for use inside the email template.
 */
function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Renders a styled, responsive HTML email shell with a title + body + CTA.
 */
function render({ title, intro, bodyHtml, ctaLabel, ctaHref, footer }) {
  const baseUrl = cfg.baseUrl;
  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="light" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f3f4f6;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
            <!-- Brand -->
            <tr>
              <td align="center" style="padding:0 0 20px;">
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td align="center" style="width:44px;height:44px;border-radius:12px;background-color:#f06d02;">
                      <span style="display:inline-block;color:#ffffff;font-size:22px;font-weight:700;line-height:44px;text-align:center;">QB</span>
                    </td>
                  </tr>
                </table>
                <p style="margin:8px 0 0;color:#111827;font-size:18px;font-weight:700;">Question Bank</p>
              </td>
            </tr>

            <!-- Card -->
            <tr>
              <td style="background-color:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.08);">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr><td style="background-color:#f06d02;height:6px;font-size:0;line-height:0;">&nbsp;</td></tr>
                </table>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 40px;">
                  <tr>
                    <td>
                      <h1 style="margin:0 0 20px;color:#111827;font-size:22px;font-weight:700;">${escapeHtml(title)}</h1>
                      <p style="margin:0 0 16px;color:#4b5563;font-size:15px;line-height:1.6;">${intro}</p>
                      ${bodyHtml}
                      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                        <tr>
                          <td align="center" style="padding:8px 0 20px;">
                            <a href="${escapeHtml(ctaHref)}" style="display:inline-block;padding:12px 28px;border-radius:10px;background-color:#f06d02;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;">${escapeHtml(ctaLabel)}</a>
                          </td>
                        </tr>
                      </table>
                      <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0;" />
                      <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.5;">${footer}</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td align="center" style="padding:20px 0 0;">
                <p style="margin:0;color:#9ca3af;font-size:12px;">&copy; ${new Date().getFullYear()} Question Bank &middot; ${escapeHtml(baseUrl)}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
  </html>
  `.trim();
}

/**
 * Sends an email. Returns { ok, error? } and never throws.
 * Silently no-ops when SMTP is not configured so the server keeps working.
 */
async function send({ to, subject, title, intro, bodyHtml, ctaLabel, ctaHref, footer }) {
  if (!transporter || !cfg.from) {
    return { ok: false, error: "Mail not configured (set MAIL_ENABLED=true and credentials)." };
  }
  try {
    await transporter.sendMail({
      from: cfg.from,
      to,
      subject,
      html: render({ title, intro, bodyHtml, ctaLabel, ctaHref, footer }),
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Sends a welcome + password-reset email to a newly registered teacher.
 * No plaintext password is included — the teacher sets their own via the link.
 */
export async function sendTeacherRegistrationEmail({ email, name, resetLink }) {
  return send({
    to: email,
    subject: "Welcome to Question Bank — Set Up Your Password",
    title: `Welcome aboard, ${escapeHtml(name)}!`,
    intro:
      "Your teacher account for <strong>Question Bank</strong> has been created by the platform administrator. To get started, please set your own password using the secure link below.",
    bodyHtml: `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#fff7ed;border:1px solid #fed7aa;border-radius:12px;margin:0 0 8px;">
        <tr>
          <td style="padding:16px 20px;">
            <p style="margin:0 0 4px;color:#6b7280;font-size:14px;">Sign in with</p>
            <p style="margin:0;color:#111827;font-size:15px;font-weight:600;">${escapeHtml(email)}</p>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 16px;color:#4b5563;font-size:14px;line-height:1.6;">
        The link below is valid for <strong>24 hours</strong> and can only be used once. After choosing your
        password you can sign in and start working with your question banks.
      </p>`,
    ctaLabel: "Set Your Password",
    ctaHref: resetLink,
    footer:
      "This email was sent automatically by the Question Bank admin panel. If you received it in error, please ignore it and contact your administrator.",
  });
}

/**
 * Sends a password-reset email for an existing account.
 */
export async function sendPasswordResetEmail({ email, name, resetLink }) {
  return send({
    to: email,
    subject: "Reset Your Question Bank Password",
    title: "Reset your password",
    intro: `Hi ${escapeHtml(name)}, we received a request to reset the password for your <strong>Question Bank</strong> account (${escapeHtml(email)}).`,
    bodyHtml: `
      <p style="margin:0 0 16px;color:#4b5563;font-size:14px;line-height:1.6;">
        Click the button below to choose a new password. This link is valid for <strong>24 hours</strong> and can
        only be used once. If you didn’t request this, you can safely ignore this email.
      </p>`,
    ctaLabel: "Reset Password",
    ctaHref: resetLink,
    footer: "This link will expire in 24 hours. If it has expired, please request a new one.",
  });
}
