import { Codex } from '../lib/codex.mjs';

const models = await new Codex().models();
for (const model of models) {
  console.log(`${model.isDefault ? '* ' : '  '}${model.model}: ${model.efforts.join(', ') || 'sem nível configurável'}; padrão: ${model.defaultEffort || 'nenhum'}`);
}
