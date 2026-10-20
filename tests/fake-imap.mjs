// Minimal IMAP4rev1 server for tests: enough of the protocol for imapflow to log in, examine INBOX,
// search (including Gmail X-GM-RAW) and fetch envelopes, body structures and body sections.
import { createServer } from 'node:net';

const q = value => value === null || value === undefined ? 'NIL' : `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const words = text => /[^\x20-\x7e]/.test(text) ? `=?UTF-8?B?${Buffer.from(text).toString('base64')}?=` : text;
const address = ({ name, mailbox, host }) => `((${name ? q(words(name)) : 'NIL'} NIL ${q(mailbox)} ${q(host)}))`;
const leaf = part => `("TEXT" ${q(part.subtype.toUpperCase())} ("CHARSET" ${q(part.charset)}) NIL NIL ${q(part.encoding)} ${part.body.length} ${part.body.split('\n').length})`;

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const pad = value => String(value).padStart(2, '0');
const internalDate = date => `${pad(date.getUTCDate())}-${MONTHS[date.getUTCMonth()]}-${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} +0000`;

export async function startFakeImap({ user, pass, uidValidity = 777, messages = [], gmail = true } = {}) {
  const state = { uidValidity, messages, commands: [] };
  const server = createServer(socket => {
    let buffer = '';
    const send = line => socket.write(line + '\r\n');
    send(`* OK [CAPABILITY IMAP4rev1${gmail ? ' X-GM-EXT-1' : ''}] fake ready`);
    socket.on('error', () => {});
    socket.on('data', chunk => {
      buffer += chunk.toString('latin1');
      let end;
      while ((end = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        handle(line);
      }
    });
    const handle = line => {
      const [tag, ...rest] = line.split(' ');
      let command = (rest[0] || '').toUpperCase(); let args = rest.slice(1).join(' ');
      if (command === 'UID') { command = 'UID ' + (rest[1] || '').toUpperCase(); args = rest.slice(2).join(' '); }
      state.commands.push(command === 'LOGIN' ? 'LOGIN ***' : `${command} ${args}`);
      const ok = (text = 'done') => send(`${tag} OK ${text}`);
      switch (command) {
        case 'CAPABILITY': send(`* CAPABILITY IMAP4rev1${gmail ? ' X-GM-EXT-1' : ''}`); return ok();
        case 'LOGIN': {
          const [, givenUser, givenPass] = args.match(/^"?([^" ]+)"? "?([^"]*)"?$/) || [];
          if (givenUser !== user || givenPass !== pass) return send(`${tag} NO [AUTHENTICATIONFAILED] Invalid credentials`);
          send(`* CAPABILITY IMAP4rev1${gmail ? ' X-GM-EXT-1' : ''}`); return ok('logged in');
        }
        case 'LIST': send('* LIST (\\HasNoChildren) "/" "INBOX"'); return ok();
        case 'EXAMINE': case 'SELECT': {
          const next = Math.max(0, ...state.messages.map(item => item.uid)) + 1;
          send(`* ${state.messages.length} EXISTS`); send('* 0 RECENT'); send('* FLAGS (\\Seen)');
          send(`* OK [UIDVALIDITY ${state.uidValidity}] ok`); send(`* OK [UIDNEXT ${next}] ok`);
          return ok(command === 'EXAMINE' ? '[READ-ONLY] examined' : '[READ-WRITE] selected');
        }
        case 'UID SEARCH': {
          const text = args.replace(/^CHARSET \S+ /i, '');
          // imapflow sends simple values as atoms and the rest as quoted strings.
          const value = name => { const found = text.match(new RegExp(`${name} (?:"((?:[^"\\\\]|\\\\.)*)"|(\\S+))`, 'i')); return found ? found[1] ?? found[2] : undefined; };
          const raw = value('X-GM-RAW'), from = value('FROM'), subject = value('SUBJECT'), since = value('SINCE')?.replace(/-/g, ' ');
          const hit = item => (!raw || `${item.from.mailbox}@${item.from.host} ${item.subject}`.toLowerCase().includes(raw.replace(/^from:/, '').toLowerCase()))
            && (!from || `${item.from.mailbox}@${item.from.host}`.includes(from)) && (!subject || item.subject.includes(subject))
            && (!since || item.date >= new Date(since + ' UTC'));
          send(`* SEARCH ${state.messages.filter(hit).map(item => item.uid).join(' ')}`.trimEnd()); return ok();
        }
        case 'UID FETCH': {
          const [, set, items] = args.match(/^(\S+) \((.*)\)$/) || args.match(/^(\S+) (.*)$/);
          const max = Math.max(0, ...state.messages.map(item => item.uid));
          const wanted = new Set();
          for (const range of set.split(',')) {
            const [a, b] = range.split(':'); const start = a === '*' ? max : Number(a); const stop = b === undefined ? start : b === '*' ? max : Number(b);
            for (const item of state.messages) if (item.uid >= Math.min(start, stop) && item.uid <= Math.max(start, stop)) wanted.add(item.uid);
            if (b === '*' && start > max && max) wanted.add(max); // RFC 3501: "n:*" includes the highest UID.
          }
          state.messages.forEach((item, index) => { if (wanted.has(item.uid)) fetchOne(index + 1, item, items); });
          return ok();
        }
        case 'LOGOUT': send('* BYE bye'); ok(); socket.end(); return;
        default: return ok();
      }
    };
    const fetchOne = (seq, item, items) => {
      const pieces = [`UID ${item.uid}`]; const literals = [];
      if (/ENVELOPE/i.test(items)) {
        const from = address(item.from);
        pieces.push(`ENVELOPE (${q(item.date.toUTCString())} ${q(words(item.subject))} ${from} ${from} ${from} ((NIL NIL "pessoa" "example.com")) NIL NIL NIL ${q(`<${item.uid}@fake>`)})`);
      }
      if (/INTERNALDATE/i.test(items)) pieces.push(`INTERNALDATE "${internalDate(item.date)}"`);
      if (/BODYSTRUCTURE/i.test(items)) pieces.push(`BODYSTRUCTURE ${item.parts.length === 1 ? leaf(item.parts[0]) : `(${item.parts.map(leaf).join('')} "ALTERNATIVE")`}`);
      for (const [, section, start, length] of items.matchAll(/BODY\.PEEK\[([^\]]*)\](?:<(\d+)\.(\d+)>)?/gi)) {
        const single = item.parts.length === 1; const key = section.toUpperCase();
        let data;
        if (key === 'HEADER' || /^\d+\.MIME$/.test(key)) {
          const part = item.parts[key === 'HEADER' ? 0 : Number(key.split('.')[0]) - 1];
          data = `Content-Type: text/${part.subtype}; charset=${part.charset}\r\nContent-Transfer-Encoding: ${part.encoding}\r\n\r\n`;
        } else if (key === 'TEXT' && single) data = item.parts[0].body;
        else data = item.parts[Number(key) - 1].body;
        if (start !== undefined) data = data.slice(Number(start), Number(start) + Number(length));
        literals.push(`BODY[${section}]${start !== undefined ? `<${start}>` : ''}`, data);
      }
      let line = `* ${seq} FETCH (${pieces.join(' ')}`;
      for (let i = 0; i < literals.length; i += 2) {
        socket.write(`${line} ${literals[i]} {${Buffer.byteLength(literals[i + 1], 'latin1')}}\r\n`);
        socket.write(Buffer.from(literals[i + 1], 'latin1'));
        line = '';
      }
      socket.write(`${line})\r\n`);
    };
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { port: server.address().port, state, close: () => new Promise(resolve => { server.close(resolve); server.unref(); }) };
}
