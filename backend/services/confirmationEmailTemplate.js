const palette = { lagoon: '#27777e', deep: '#114a55', gold: '#b79a6c', ivory: '#f7f5ef', border: '#e3ddd0' };

function renderConfirmationEmail({ reservation, escapeHtml, depositHtml, cancelHtml, siteUrl }) {
  const date = new Date(reservation.date).toLocaleDateString('fr-FR', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  const row = (label, value) => `<tr><td style="padding:12px 0;border-bottom:1px solid ${palette.border};color:${palette.deep};font-size:14px;">${label}</td><td align="right" style="padding:12px 0 12px 16px;border-bottom:1px solid ${palette.border};color:${palette.deep};font-size:16px;font-weight:bold;overflow-wrap:anywhere;">${escapeHtml(value)}</td></tr>`;
  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Votre réservation est confirmée</title>
<style>@media only screen and (max-width:480px){.email-content{padding:28px 20px!important}.email-title{font-size:27px!important}}</style></head>
<body style="margin:0;padding:0;background-color:${palette.ivory};color:${palette.deep};font-family:Verdana,Geneva,sans-serif;">
<div style="display:none;font-size:1px;color:${palette.ivory};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">Votre table vous attend le ${escapeHtml(date)} à ${escapeHtml(reservation.time)} pour ${escapeHtml(reservation.numberOfPeople)} personne(s).</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="${palette.ivory}"><tr><td align="center" style="padding:24px 12px;">
<!--[if mso]><table role="presentation" width="600"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;border:1px solid ${palette.border};">
<tr><td align="center" style="padding:30px 20px 26px;border-top:4px solid ${palette.gold};border-bottom:1px solid ${palette.border};background-color:${palette.ivory};">
<img src="https://raw.githubusercontent.com/Gleekch/restaurant-booking-backend/main/assets/logo.png" width="100" height="100" alt="Au Murmure des Flots" style="display:block;margin:0 auto 18px;border:0;width:100px;height:100px;">
<p style="margin:0;color:${palette.deep};font-size:20px;font-weight:bold;">Au Murmure des Flots</p>
<p style="margin:9px 0 0;color:${palette.deep};font-size:11px;letter-spacing:2px;text-transform:uppercase;">Restaurant bistronomique &middot; Saint-Leu</p></td></tr>
<tr><td class="email-content" style="padding:36px 32px;">
<p style="margin:0 0 12px;color:${palette.lagoon};font-size:12px;letter-spacing:2px;text-transform:uppercase;font-weight:bold;">Réservation confirmée</p>
<h1 class="email-title" style="margin:0 0 24px;color:${palette.deep};font-family:Georgia,'Times New Roman',serif;font-size:32px;line-height:1.2;font-weight:normal;">Nous vous attendons.</h1>
<p style="margin:0 0 14px;font-size:15px;line-height:1.7;">Bonjour ${escapeHtml(reservation.customerName)},</p>
<p style="margin:0 0 26px;font-size:15px;line-height:1.7;">Notre équipe a confirmé votre réservation. Nous serons heureux de vous accueillir au Murmure des Flots.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:2px solid ${palette.lagoon};margin-bottom:24px;">
${row('Date', date)}${row('Heure', reservation.time)}${row('Convives', `${reservation.numberOfPeople} ${reservation.numberOfPeople > 1 ? 'personnes' : 'personne'}`)}</table>
${reservation.specialRequests ? `<p style="margin:0 0 24px;font-size:14px;line-height:1.7;overflow-wrap:anywhere;"><strong>Votre message</strong><br>${escapeHtml(reservation.specialRequests)}</p>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td style="padding:18px;background-color:${palette.ivory};border-left:3px solid ${palette.gold};font-size:14px;line-height:1.7;"><strong>Pour préparer votre venue</strong><br>Merci de nous informer de toute allergie ou préférence alimentaire.</td></tr></table>
${depositHtml}
${cancelHtml}
<p style="margin:28px 0 12px;font-size:14px;line-height:1.7;">Une question ? Notre équipe reste à votre disposition.</p>
<p style="margin:0;font-size:14px;line-height:1.9;"><a href="tel:0262266719" style="color:${palette.lagoon};text-decoration:underline;">02 62 26 67 19</a><br><a href="mailto:aumurmuredesflots@gmail.com" style="color:${palette.lagoon};text-decoration:underline;overflow-wrap:anywhere;">aumurmuredesflots@gmail.com</a><br>44 rue du Général Lambert<br>97436 Saint-Leu</p>
</td></tr><tr><td align="center" style="padding:24px;background-color:${palette.deep};border-bottom:4px solid ${palette.gold};">
<a href="${escapeHtml(siteUrl)}" style="color:#ffffff;font-size:13px;text-decoration:underline;">Découvrir le restaurant</a>
<p style="margin:14px 0 0;color:#ffffff;font-size:11px;line-height:1.6;">Au Murmure des Flots &middot; Saint-Leu</p></td></tr></table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`;
}

module.exports = { renderConfirmationEmail };
