export async function readTermuxJson(run, operation, payload) {
  let serialized = '', offset = 0;
  do {
    const result = await run(operation, { ...payload, offset });
    if (result.exitCode !== 0 || result.errorMessage) throw new Error('Não foi possível ler os dados salvos no Termux. Confira a conexão.');
    let page;
    try { page = JSON.parse(result.stdout); } catch { throw new Error('Os dados salvos no Termux estão inválidos.'); }
    if (typeof page.chunk !== 'string' || (page.nextOffset !== null && page.nextOffset !== offset + 12000)) throw new Error('O trecho recebido do Termux está inválido.');
    serialized += page.chunk;
    offset = page.nextOffset;
    if (serialized.length > 20_000_000) throw new Error('O arquivo salvo é grande demais.');
  } while (offset !== null);
  try { return JSON.parse(serialized); } catch { throw new Error('O arquivo salvo no Termux está inválido.'); }
}
