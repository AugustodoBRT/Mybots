/** Diagnostic text may include CLI stderr. Remove credentials before showing/copying it. */
export function diagnosticText(value) {
  return String(value || '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/Bearer\s+[^\s"',;]+/gi, 'Bearer [redigido]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{12,}|sess-[A-Za-z0-9_-]{16,}|codex_[A-Za-z0-9_-]{16,})\b/g, '[token redigido]')
    .replace(/((?:encryptedToken|access_token|refresh_token|client_secret|api_key|token|password|senha)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/gi, '$1"[redigido]"')
    .replace(/((?:encryptedToken|access_token|refresh_token|client_secret|api_key|token|password|senha)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi, '$1[redigido]')
    .slice(-24000);
}

/** Always show Android's local report first; a missing/hung supervisor must never hide it. */
export async function showDiagnostics({ readDeviceInfo, call, connected, publish, timeoutMs = 3000 }) {
  let local;
  try { local = diagnosticText(await readDeviceInfo()); }
  catch (error) { local = 'Não consegui ler todos os dados do aparelho: ' + diagnosticText(error.message); }
  publish(local);
  if (!connected) { publish(local + '\n\nSupervisor desconectado. Os dados acima foram lidos diretamente do aparelho.'); return; }
  let timer;
  try {
    const result = await Promise.race([call('environment.get'), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('O supervisor não respondeu ao diagnóstico complementar.')), timeoutMs); })]);
    publish(local + '\n\n' + diagnosticText(result.report));
  } catch (error) { publish(local + '\n\nRelatório complementar indisponível: ' + diagnosticText(error.message)); }
  finally { clearTimeout(timer); }
}
