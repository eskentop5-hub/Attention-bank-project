// Публикация новых заданий в Telegram-группу/канал
import { config } from '../config.js';
import { sendMessage, escapeHtml, linkButton } from './api.js';
import { categoryLabel } from '../catalog.js';

export async function postCampaignToGroup(campaign, company) {
  if (!config.telegram.groupId) return null;
  const text =
    `🆕 <b>Новое задание</b>\n` +
    `<b>${escapeHtml(campaign.title)}</b>\n` +
    `${escapeHtml(categoryLabel(campaign.category))} · ${escapeHtml(company.company_name || company.name)}\n\n` +
    `💰 Награда: <b>+${campaign.reward} AB</b>\n` +
    `👥 Мест: ${campaign.max_participants}\n\n` +
    (/localhost|127\.0\.0\.1/.test(config.publicUrl) ? `Открыть: ${config.publicUrl}/#/tasks/${campaign.id}` : '');
  return sendMessage(config.telegram.groupId, text, linkButton('Выполнить задание', `/#/tasks/${campaign.id}`));
}
