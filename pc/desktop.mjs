import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { toolArguments } from '../supervisor/tool-policy.mjs';

const execAsync = promisify(execFile);
const exec = (bin, argv, { input, ...options } = {}) => {
  const pending = execAsync(bin, argv, options);
  if (input !== undefined) pending.child.stdin.end(input);
  return pending;
};
const CODES = { CTRL: 29, ALT: 56, SHIFT: 42, SUPER: 125, ENTER: 28, TAB: 15, ESC: 1, BACKSPACE: 14, DELETE: 111, SPACE: 57, UP: 103, DOWN: 108, LEFT: 105, RIGHT: 106, HOME: 102, END: 107, A: 30, C: 46, V: 47, X: 45, Z: 44, L: 38, F: 33, S: 31 };

/** No shell, fixed executables, bounded output, and cancellation passed to every child. */
export class Desktop {
  constructor({ run = exec } = {}) { this.run = run; }
  async command(op, input, signal) {
    const args = toolArguments(op, input); const kind = op.slice(8);
    const run = async (bin, argv, options = {}) => {
      signal?.throwIfAborted();
      try { return (await this.run(bin, argv, { timeout: 15000, maxBuffer: 16 * 1024 * 1024, signal, ...options })).stdout; }
      catch (error) {
        if (signal?.aborted) throw new Error('Controle do computador interrompido.');
        if (bin === 'ydotool') throw new Error('ydotool indisponível. Instale ydotool e ative ydotoold (serviço do usuário ydotool); ele precisa de acesso a /dev/uinput.');
        throw new Error(`${bin} não conseguiu executar a ação. Confira a sessão Wayland/Hyprland e as dependências.`);
      }
    };
    if (kind === 'screenshot') {
      const data = await run('grim', ['-'], { encoding: 'buffer' });
      if (data.length > 12 * 1024 * 1024) throw new Error('A captura ficou grande demais. Reduza a resolução da tela.');
      return { image: data.toString('base64') };
    }
    if (kind === 'windows') {
      const clients = JSON.parse(await run('hyprctl', ['-j', 'clients']));
      return { windows: clients.slice(0, 200).map(({ address, title, class: app, at, size, workspace }) => ({ address, title: String(title).slice(0, 300), app, at, size, workspace: workspace?.id })) };
    }
    if (kind === 'focus') {
      await run('hyprctl', ['dispatch', 'focuswindow', 'address:' + args.address]);
      const window = JSON.parse(await run('hyprctl', ['-j', 'clients'])).find(item => item.address === args.address);
      if (!window || !window.at?.every(Number.isFinite) || !window.size?.every(Number.isFinite)) throw new Error('A janela mudou ou fechou. Use desktop_windows de novo.');
      // Hyprland follows the pointer: focusing another monitor must bring the pointer there too.
      await run('hyprctl', ['dispatch', 'movecursor', `${Math.round(window.at[0] + window.size[0] / 2)} ${Math.round(window.at[1] + window.size[1] / 2)}`]);
      await run('hyprctl', ['dispatch', 'focuswindow', 'address:' + args.address]);
    }
    if (kind === 'launch') await run('hyprctl', ['dispatch', 'exec', args.app]);
    if (kind === 'click') {
      await run('ydotool', ['mousemove', '--absolute', '-x', String(args.x), '-y', String(args.y)]);
      await run('ydotool', ['click', { left: '0xC0', right: '0xC1', middle: '0xC2' }[args.button]]);
    }
    if (kind === 'type') {
      if (/^[a-zA-Z0-9 \t\r\n]*$/.test(args.text)) await run('ydotool', ['type', '--key-delay', '0', '--', args.text]);
      else {
        // ydotool drops Unicode and symbols depend on the layout. Paste, then restore the clipboard.
        let types = [];
        try { types = String((await this.run('wl-paste', ['--list-types'], { timeout: 2000 })).stdout).trim().split('\n').filter(Boolean); }
        catch (error) { if (error.code !== 1) throw new Error('Para digitar símbolos e acentos, instale wl-clipboard e confira a sessão Wayland.'); }
        const formats = types.filter(type => !['UTF8_STRING', 'STRING', 'TEXT', 'text/plain', 'text/plain;charset=utf-8', 'text/plain;charset=UTF-8'].includes(type));
        if (formats.length && types.length > 1) throw new Error('A área de transferência tem vários formatos que não posso preservar. Para este texto com símbolos ou acentos, use browser_type em sites ou peça à pessoa para esvaziar a área de transferência.');
        const mime = formats[0] || 'text/plain;charset=utf-8';
        const previous = types.length ? (await this.run('wl-paste', ['--no-newline', '--type', mime], { timeout: 2000, encoding: 'buffer', maxBuffer: 20 * 1024 * 1024 })).stdout : null;
        try {
          await run('wl-copy', ['--type', 'text/plain;charset=utf-8', '--', args.text]);
          const active = JSON.parse(await run('hyprctl', ['-j', 'activewindow']));
          const terminal = /kitty|alacritty|wezterm|(^|\.)foot$|gnome-terminal|konsole/i.test(active.class || '');
          await this.command('desktop.key', { keys: terminal ? ['CTRL', 'SHIFT', 'V'] : ['CTRL', 'V'] }, signal);
          await new Promise(resolve => setTimeout(resolve, 100));
        } finally {
          // If the person copied something meanwhile, leave their new clipboard alone.
          const current = await this.run('wl-paste', ['--no-newline'], { timeout: 2000 }).catch(() => null);
          if (String(current?.stdout) === args.text) {
            await this.run('wl-copy', previous === null ? ['--clear'] : ['--type', mime], { timeout: 2000, ...(previous === null ? {} : { input: previous }) });
          }
        }
      }
    }
    if (kind === 'key') {
      const keys = args.keys.map(key => CODES[key]);
      try { await run('ydotool', ['key', ...keys.map(key => key + ':1'), ...keys.toReversed().map(key => key + ':0')]); }
      finally { await this.run('ydotool', ['key', ...keys.toReversed().map(key => key + ':0')], { timeout: 2000 }).catch(() => {}); }
    }
    return { done: true };
  }
  async indicate(bot) {
    try {
      const { stdout } = await this.run('notify-send', ['--print-id', '--app-name=MyBots', '--urgency=critical', '--expire-time=0', '--hint=boolean:resident:true', 'MyBots está controlando o computador', `${String(bot.name).slice(0, 60)} · Para interromper: Super+Shift+Esc (se configurado) ou Cancelar no MyBots.`], { timeout: 3000 });
      const id = stdout.trim();
      return () => /^\d+$/.test(id) ? this.run('gdbus', ['call', '--session', '--dest', 'org.freedesktop.Notifications', '--object-path', '/org/freedesktop/Notifications', '--method', 'org.freedesktop.Notifications.CloseNotification', id], { timeout: 2000 }).catch(() => {}) : Promise.resolve();
    } catch { throw new Error('Não consegui mostrar o aviso de controle. Confira o swaync; nenhuma ação foi executada.'); }
  }
}
