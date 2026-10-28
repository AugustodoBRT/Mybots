import { randomUUID } from 'node:crypto';

export const CHANNELS = { whatsapp: 'WhatsApp', olx: 'OLX', marketplace: 'Facebook Marketplace', email: 'E-mail' };
export const TONES = { friendly: 'cordial', direct: 'direto', formal: 'formal', casual: 'descontraído' };
const OPEN = ['active', 'awaiting_you'];
const now = () => new Date().toISOString();
const reais = cents => `R$ ${Math.floor(cents / 100).toLocaleString('pt-BR')},${String(cents % 100).padStart(2, '0')}`;
const cents = (value, name) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1e7 || Math.abs(Math.round(value * 100) - value * 100) > 1e-6) throw new Error(`Em ${name}, informe o valor em reais com até duas casas, como 129.9.`);
  return Math.round(value * 100);
};

/** Every price written in a message ("R$ 1.200,50", "900 reais") in cents, to compare with the amount the bot declared. */
export function pricesIn(text) {
  const found = [];
  const read = raw => { const value = raw.replace(/\./g, '').replace(',', '.'); const number = Number(value); if (Number.isFinite(number)) found.push(Math.round(number * 100)); };
  for (const match of String(text).matchAll(/R\$\s*(\d[\d.]*(?:,\d{1,2})?)/gi)) read(match[1]);
  for (const match of String(text).matchAll(/(\d[\d.]*(?:,\d{1,2})?)\s*reais/gi)) read(match[1]);
  return found;
}

/** The hard limits: nothing the model says changes them. `at` is the clock of the supervisor. */
export function checkOffer(mandate, { amount, channel }, at) {
  if (!OPEN.includes(mandate.status)) throw new Error(mandate.status === 'expired' ? 'O prazo deste mandato acabou. Pare de negociar e avise a pessoa.' : 'Este mandato está encerrado. Não envie mais ofertas.');
  if (at > Date.parse(mandate.deadline)) throw new Error('O prazo deste mandato acabou. Pare de negociar e avise a pessoa.');
  if (!mandate.channels.includes(channel)) throw new Error(`O canal ${CHANNELS[channel] || channel} não está no mandato. Canais permitidos: ${mandate.channels.map(item => CHANNELS[item]).join(', ')}.`);
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('Informe um valor maior que zero.');
  if (mandate.side === 'buy' && amount > mandate.limit) throw new Error(`Oferta acima do teto: o mandato permite pagar no máximo ${reais(mandate.limit)}.`);
  if (mandate.side === 'sell' && amount < mandate.limit) throw new Error(`Oferta abaixo do mínimo: o mandato permite vender por no mínimo ${reais(mandate.limit)}.`);
}
const within = (mandate, amount) => mandate.side === 'buy' ? amount <= mandate.limit : amount >= mandate.limit;

/**
 * Negotiation mandates. The person sets what a bot may offer (goal, target, the ceiling or floor, channels, deadline and
 * whether it may close); the bot declares each offer before sending it and this module refuses what the mandate does not
 * cover. A deal the bot cannot close alone becomes a proposal the person accepts or refuses.
 */
export class Negotiations {
  constructor(db, { changed = () => {}, notify = async () => {}, answer = () => {}, clock = () => Date.now() } = {}) { Object.assign(this, { db, changed, notify, answer, clock }); }
  mandate(row) { return { id: row.id, botId: row.bot_id, ...JSON.parse(row.body), status: row.status, createdAt: row.created_at, updatedAt: row.updated_at }; }
  offers(id, limit = 30) {
    return this.db.all('SELECT * FROM negotiation_offers WHERE negotiation_id=? ORDER BY rowid DESC LIMIT ?', id, limit).reverse().map(row => ({ id: row.id, ...JSON.parse(row.body), state: row.state, at: row.created_at }));
  }
  view(row) {
    const offers = this.offers(row.id); const mandate = this.mandate(row);
    return { ...mandate, offers, lastOffer: [...offers].reverse().find(item => item.state !== 'refused' && item.state !== 'blocked') || null, proposal: offers.find(item => item.state === 'proposed') || null };
  }
  /** Mandates past their deadline end, with any open proposal refused; the clock is the supervisor's. */
  expire() {
    for (const row of this.db.all(`SELECT * FROM negotiations WHERE status IN ('active','awaiting_you') AND deadline<?`, new Date(this.clock()).toISOString())) {
      this.db.transaction(() => {
        this.db.run("UPDATE negotiations SET status='expired',updated_at=? WHERE id=?", now(), row.id);
        this.db.run("UPDATE negotiation_offers SET state='refused' WHERE negotiation_id=? AND state='proposed'", row.id);
      });
      this.db.record('negotiation_expired', `Mandato vencido: ${JSON.parse(row.body).objective}`.slice(0, 300), row.bot_id);
      this.changed('activity.new');
    }
  }
  list() { this.expire(); return this.db.all('SELECT * FROM negotiations ORDER BY rowid DESC LIMIT 60').map(row => this.view(row)); }
  /** What the app shows: the proposals waiting for the person (the Aceitar/Recusar cards) and each bot's mandates. */
  pending() { return this.list().filter(item => item.proposal).map(item => ({ negotiationId: item.id, botId: item.botId, objective: item.objective, side: item.side, limit: item.limit, canClose: item.canClose, deadline: item.deadline, proposal: item.proposal, outside: !within(item, item.proposal.amount) })); }
  /** The proposals as cards of the same shape as an approval, so the app lists them with the others (Aceitar / Recusar). */
  cards() {
    return this.pending().map(item => {
      const offer = item.proposal; const buy = item.side === 'buy';
      const why = item.outside ? `Fora do mandato: ${buy ? 'o teto é' : 'o mínimo é'} ${reais(item.limit)}.` : 'Dentro do mandato, mas ele não pode fechar sozinho.';
      return { id: 'neg:' + offer.id, kind: 'negotiation', offerId: offer.id, negotiationId: item.negotiationId, botId: item.botId, actionHash: 'negotiation', canAlways: false, expiresAt: item.deadline,
        title: `fechar ${buy ? 'a compra' : 'a venda'} por ${reais(offer.amount)}`,
        summary: [item.objective, `${CHANNELS[offer.channel]} · ${offer.to}`, offer.text, why, 'Aceitar fecha o negócio; Recusar volta a negociar dentro do mandato.'].filter(Boolean).join('\n') };
    });
  }
  get(id) {
    const row = this.db.get('SELECT * FROM negotiations WHERE id=?', id);
    if (!row) throw new Error('Negociação não encontrada.');
    return row;
  }
  /** Create (no id) or edit an open mandate. Only the person's app calls this. */
  save(params) {
    const bot = this.db.requireBot(params.botId);
    const text = (value, name, max) => { if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new Error(`Preencha ${name} (até ${max} caracteres).`); return value.trim(); };
    if (!['buy', 'sell'].includes(params.side)) throw new Error('Escolha se o bot compra ou vende.');
    const channels = Array.isArray(params.channels) ? [...new Set(params.channels)] : [];
    if (!channels.length || channels.some(item => !CHANNELS[item])) throw new Error('Escolha ao menos um canal: WhatsApp, OLX, Facebook Marketplace ou e-mail.');
    const money = (value, name) => cents(typeof value === 'string' ? Number(value.replace(',', '.')) : value, name);
    const target = money(params.target, 'preço-alvo'); const limit = money(params.limit, params.side === 'buy' ? 'teto' : 'valor mínimo');
    if (params.side === 'buy' && target > limit) throw new Error('O preço-alvo da compra não pode passar do teto.');
    if (params.side === 'sell' && target < limit) throw new Error('O preço-alvo da venda não pode ficar abaixo do mínimo.');
    const deadline = new Date(params.deadline);
    if (!Number.isFinite(deadline.getTime()) || deadline.getTime() <= this.clock()) throw new Error('Informe um prazo no futuro.');
    if (!Object.keys(TONES).includes(params.tone || 'friendly')) throw new Error('Escolha um tom válido.');
    if (params.introduce !== undefined && typeof params.introduce !== 'boolean') throw new Error('Escolha se o bot se apresenta como assistente.');
    const body = { objective: text(params.objective, 'o objetivo', 300), side: params.side, target, limit, canClose: params.canClose === true, deadline: deadline.toISOString(), channels,
      tone: params.tone || 'friendly', introduce: params.introduce === true };
    if (params.id) {
      const row = this.get(params.id);
      if (row.bot_id !== bot.id || !OPEN.includes(row.status)) throw new Error('Só dá para editar um mandato aberto deste bot.');
      this.db.run('UPDATE negotiations SET body=?,deadline=?,updated_at=? WHERE id=?', JSON.stringify(body), body.deadline, now(), row.id);
      this.db.record('negotiation_updated', `Mandato de ${bot.name} editado: ${body.objective}`.slice(0, 300), bot.id);
      this.changed('activity.new'); return this.view(this.get(row.id));
    }
    if (this.db.all("SELECT id FROM negotiations WHERE bot_id=? AND status IN ('active','awaiting_you')", bot.id).length >= 5) throw new Error('Este bot já tem 5 mandatos abertos. Encerre algum antes.');
    const id = randomUUID();
    this.db.run('INSERT INTO negotiations VALUES(?,?,?,?,?,?,?)', id, bot.id, JSON.stringify(body), 'active', body.deadline, now(), now());
    this.db.record('negotiation_created', `Mandato para ${bot.name}: ${body.objective} (${body.side === 'buy' ? 'teto' : 'mínimo'} ${reais(body.limit)})`.slice(0, 300), bot.id);
    this.changed('activity.new'); return this.view(this.get(id));
  }
  cancel(id) {
    const row = this.get(id);
    if (!OPEN.includes(row.status)) throw new Error('Este mandato já terminou.');
    this.db.transaction(() => {
      this.db.run("UPDATE negotiations SET status='cancelled',updated_at=? WHERE id=?", now(), id);
      this.db.run("UPDATE negotiation_offers SET state='refused' WHERE negotiation_id=? AND state='proposed'", id);
    });
    this.db.record('negotiation_cancelled', `Mandato encerrado: ${JSON.parse(row.body).objective}`.slice(0, 300), row.bot_id);
    this.changed('activity.new'); return { cancelled: true };
  }
  /** The mandate a tool call is about: the one named, or the bot's only open one. */
  forBot(botId, ref) {
    this.expire();
    const rows = this.db.all("SELECT * FROM negotiations WHERE bot_id=? AND status IN ('active','awaiting_you') ORDER BY rowid", botId);
    if (ref) {
      const row = rows.find(item => item.id === ref);
      if (row) return this.mandate(row);
      const done = this.db.get('SELECT status FROM negotiations WHERE id=? AND bot_id=?', ref, botId);
      if (done?.status === 'expired') throw new Error('O prazo desse mandato acabou e a negociação foi encerrada. Pare de negociar e avise a pessoa.');
      if (done) throw new Error('Esse mandato já está encerrado. Não envie mais ofertas.');
      throw new Error('Não há mandato aberto com esse id para este bot. Veja em negotiation_status.');
    }
    if (!rows.length) {
      const last = this.db.get("SELECT status FROM negotiations WHERE bot_id=? ORDER BY rowid DESC LIMIT 1", botId);
      if (last?.status === 'expired') throw new Error('O prazo do mandato acabou e a negociação foi encerrada. Pare de negociar e avise a pessoa.');
      throw new Error('Este bot não tem mandato de negociação aberto. Não negocie: peça que a pessoa defina um no perfil do bot.');
    }
    if (rows.length > 1) throw new Error('Há mais de um mandato aberto: informe o id em negotiation (veja em negotiation_status).');
    return this.mandate(rows[0]);
  }
  guide(mandate) {
    const person = this.db.person().name;
    return [`Escreva como ${person || 'a pessoa'}, em primeira pessoa, no tom ${TONES[mandate.tone]}.`,
      mandate.introduce ? 'Apresente-se como assistente de quem negocia, no primeiro contato, e não negue ser um assistente se perguntarem.' : 'Não precisa se apresentar como assistente, mas nunca negue ser um assistente se perguntarem diretamente.',
      'Nunca peça nem digite senha, código ou dados de cartão. Se aparecer CAPTCHA ou pedido de código, chame a pessoa.'].join(' ');
  }
  status(botId) {
    this.expire();
    const rows = this.db.all('SELECT * FROM negotiations WHERE bot_id=? ORDER BY rowid DESC LIMIT 5', botId);
    return { mandates: rows.map(row => { const item = this.view(row); const { botId: _bot, proposal, ...rest } = item; return { ...rest, target: reais(item.target), limit: reais(item.limit), offers: item.offers.slice(-10).map(offer => ({ ...offer, amount: offer.amount ? reais(offer.amount) : null })),
      lastOffer: item.lastOffer && { ...item.lastOffer, amount: item.lastOffer.amount ? reais(item.lastOffer.amount) : null }, awaitingPerson: Boolean(proposal), ...(OPEN.includes(item.status) ? { how_to_write: this.guide(item) } : {}) }; }),
      note: rows.length ? 'Respeite sempre o teto/mínimo e o prazo; o MyBots recusa o que passar deles.' : 'Sem mandato: não negocie.' };
  }
  /** The bot declares an offer before sending it; the text it will send must carry the same price. */
  offer(botId, { negotiation, channel, to, amount, text }) {
    const mandate = this.forBot(botId, negotiation); const value = cents(amount, 'amount');
    const block = reason => { this.record(mandate.id, { direction: 'out', amount: value, channel, to, text: String(text).slice(0, 2000), reason }, 'blocked'); this.db.record('negotiation_blocked', `Oferta de ${reais(value)} bloqueada: ${reason}`.slice(0, 300), botId); this.changed('activity.new'); throw new Error(reason); };
    try { checkOffer(mandate, { amount: value, channel }, this.clock()); } catch (error) { return block(error.message); }
    if (mandate.status === 'awaiting_you') throw new Error('Há uma proposta esperando a decisão da pessoa. Espere a resposta dela antes de enviar outra oferta.');
    const wrong = pricesIn(text).find(price => price !== value);
    if (wrong !== undefined) return block(`O texto cita ${reais(wrong)}, mas a oferta declarada é ${reais(value)}. Escreva o mesmo valor nos dois.`);
    this.record(mandate.id, { direction: 'out', amount: value, channel, to, text: String(text).slice(0, 2000) }, 'sent');
    this.db.record('negotiation_offer', `${mandate.objective.slice(0, 80)}: oferta de ${reais(value)} (${CHANNELS[channel]})`, botId); this.changed('activity.new');
    return { approved: true, send: text, channel, message: `Oferta de ${reais(value)} liberada. Envie exatamente este texto pelo canal ${CHANNELS[channel]} (WhatsApp pelo app ou navegador, OLX/Marketplace pelo navegador, e-mail pela conta).` };
  }
  /** The other side's price is one the bot would take: close inside the mandate when allowed, else bring it to the person. */
  close(botId, { negotiation, channel, to, amount, summary }) {
    const mandate = this.forBot(botId, negotiation); const value = cents(amount, 'amount');
    if (!mandate.channels.includes(channel)) throw new Error(`O canal ${CHANNELS[channel] || channel} não está no mandato.`);
    if (mandate.status === 'awaiting_you') throw new Error('Já há uma proposta esperando a decisão da pessoa.');
    const inside = within(mandate, value);
    if (inside && mandate.canClose) {
      this.record(mandate.id, { direction: 'in', amount: value, channel, to, text: String(summary).slice(0, 2000) }, 'accepted');
      this.db.run("UPDATE negotiations SET status='closed',updated_at=? WHERE id=?", now(), mandate.id);
      this.db.record('negotiation_closed', `Negócio fechado por ${reais(value)}: ${mandate.objective}`.slice(0, 300), botId); this.changed('activity.new');
      return { closed: true, amount: reais(value), message: mandate.side === 'buy' ? `Negócio fechado por ${reais(value)}. Confirme com a outra parte e, se houver pagamento online, use browser_pay (a carteira confere as regras).` : `Negócio fechado por ${reais(value)}. Confirme com a outra parte.` };
    }
    const offer = this.record(mandate.id, { direction: 'in', amount: value, channel, to, text: String(summary).slice(0, 2000), outside: !inside, needsPermission: inside && !mandate.canClose }, 'proposed');
    this.db.run("UPDATE negotiations SET status='awaiting_you',updated_at=? WHERE id=?", now(), mandate.id);
    this.db.record('negotiation_proposal', `Proposta de ${reais(value)} esperando a sua decisão: ${mandate.objective}`.slice(0, 300), botId);
    this.changed('approval.request', { negotiationId: mandate.id, offerId: offer }); this.changed('activity.new');
    this.notify({ title: 'Proposta esperando você', body: `${mandate.objective.slice(0, 120)}: ${reais(value)}` }, { id: 'mybots-negotiation-' + mandate.id, botId }).catch(() => {});
    return { closed: false, waitingForPerson: true, message: 'Não feche sozinho: a pessoa vai ver a proposta com os botões Aceitar e Recusar. Diga à outra parte que você vai confirmar e termine esta resposta. Você recebe a decisão em uma nova mensagem.' };
  }
  /** Aceitar / Recusar on the card. Accepting closes the deal; refusing reopens the negotiation. */
  respond(offerId, accept) {
    this.expire();
    if (typeof accept !== 'boolean') throw new Error('Decisão inválida.');
    const row = this.db.get('SELECT * FROM negotiation_offers WHERE id=?', offerId);
    if (!row || row.state !== 'proposed') throw new Error('Esta proposta já foi respondida ou o prazo acabou.');
    const negotiation = this.get(row.negotiation_id); const mandate = this.mandate(negotiation); const offer = JSON.parse(row.body);
    this.db.transaction(() => {
      this.db.run('UPDATE negotiation_offers SET state=? WHERE id=?', accept ? 'accepted' : 'refused', offerId);
      this.db.run('UPDATE negotiations SET status=?,updated_at=? WHERE id=?', accept ? 'closed' : 'active', now(), negotiation.id);
    });
    this.db.record(accept ? 'negotiation_accepted' : 'negotiation_refused', `${accept ? 'Você aceitou' : 'Você recusou'} a proposta de ${reais(offer.amount)}: ${mandate.objective}`.slice(0, 300), mandate.botId);
    this.changed('activity.new');
    this.answer(mandate.botId, accept
      ? `[Negociação] A pessoa ACEITOU a proposta de ${reais(offer.amount)} (${mandate.objective}). Confirme o negócio com a outra parte${mandate.side === 'buy' ? '; se houver pagamento online, use browser_pay' : ''}.`
      : `[Negociação] A pessoa RECUSOU a proposta de ${reais(offer.amount)} (${mandate.objective}). O mandato continua aberto: responda à outra parte e siga negociando dentro do ${mandate.side === 'buy' ? 'teto' : 'mínimo'} de ${reais(mandate.limit)}.`);
    return { responded: true, accepted: accept };
  }
  record(negotiationId, body, state) {
    const id = randomUUID();
    this.db.run('INSERT INTO negotiation_offers VALUES(?,?,?,?,?)', id, negotiationId, JSON.stringify(body), state, now());
    return id;
  }
}
