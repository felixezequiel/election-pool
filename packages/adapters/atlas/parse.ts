/**
 * Extração de cenários da AtlasIntel — DELIBERADAMENTE NÃO IMPLEMENTADA.
 *
 * Isto não é um stub esquecido: é a conclusão da investigação da fonte primária
 * (protocolo e capturas em `__fixtures__/README.md`, 2026-08-17). Ler antes de
 * "terminar" esta função.
 *
 * O que a AtlasIntel publica, verificado ao vivo:
 *
 * | Superfície | Host | robots.txt | Contém números? | Contém registro TSE? |
 * |---|---|---|---|---|
 * | `/api/public-polls/<cat>` (JSON) | atlasintel.org | 404 ⇒ permite | NÃO | NÃO |
 * | `/poll/<slug>` (HTML) | atlasintel.org | 404 ⇒ permite | NÃO | NÃO |
 * | `<uuid>.pdf` (relatório) | cdn.atlasintel.org | **`Disallow: /`** | (único lugar) | (não verificável) |
 * | `<uuid>.pdf` (a partir de 2026-08-13) | cdn1.atlasintel.org | sem robots ⇒ permite | (único lugar) | (nenhum arquivo ainda) |
 *
 * Ou seja: as duas superfícies que a etiqueta de crawler nos permite buscar
 * (docs/04 §6) trazem SÓ metadado — título, data, tamanho de amostra, nome do
 * arquivo. Nenhum percentual e, decisivo, nenhum `tse_id`. Os números existem
 * apenas dentro do relatório em PDF, e o `robots.txt` de `cdn.atlasintel.org`
 * proíbe todo agente de buscá-lo (`User-agent: * / Disallow: /`, arquivo real
 * congelado em `__fixtures__/04-robots-cdn.atlasintel.org.txt`).
 *
 * Consequência: **não existe documento capturável cuja estrutura possa ser
 * parseada.** Escrever um parser aqui significaria inventar a estrutura do PDF —
 * exatamente o erro do `docs/OPEN-QUESTIONS.md` Q-09, onde um adapter escrito
 * contra estrutura SUPOSTA passou testes por uma task inteira trazendo zero dado.
 * Não repetimos aquilo: enquanto não houver captura real, esta função RECUSA.
 *
 * Como isto deixa de recusar (na ordem):
 * 1. Um relatório com `file_created_on >= 2026-08-13` aparecer no feed. Ele será
 *    servido por `cdn1.atlasintel.org`, que não tem `robots.txt` — logo é
 *    buscável pelo `HttpClient` sem violar a §6. Em 2026-08-17 o feed não tinha
 *    nenhum (o mais novo era 2026-08-12).
 * 2. Congelar esse PDF como fixture — respeitando R3/docs/08 §2: o relatório da
 *    Atlas é um deck de gráficos, e gráfico do instituto é obra protegida que
 *    "nunca copiamos, nunca embutimos". Isso provavelmente significa fixture de
 *    TEXTO extraído (`extractPdfText`), não o PDF.
 * 3. Só então escrever o parser contra o texto real, reusando
 *    `base/scenario-lines` (que já classifica branco/nulo e não-sabe) e
 *    `cnt-mda/pdf` (extração de texto), como o cnt-mda faz.
 * 4. Verificar que o PDF traz o número de registro TSE. Sem ele o V6 recusa e o
 *    adapter continua sem funcionar — nesse caso a fonte é inviável para nós e a
 *    decisão sobe para `docs/OPEN-QUESTIONS.md`.
 */

import { ParseError } from '../poll-source-adapter.js';
import type { RawScenario } from '../base/base-adapter.js';

/**
 * Mensagem única da recusa. Exportada para o spec poder afirmar o motivo, em vez
 * de só afirmar "lançou" — o motivo é o entregável desta task.
 */
export const ATLAS_NO_PARSABLE_SOURCE =
  'AtlasIntel: nenhuma superfície buscável publica resultado. O JSON de ' +
  '/api/public-polls e o HTML de /poll/<slug> trazem só metadado (sem percentual ' +
  'e sem tse_id); o relatório em PDF, que é o único lugar com números, está em ' +
  'cdn.atlasintel.org, cujo robots.txt responde "Disallow: /" para todo agente ' +
  '(docs/04 §6). Parser não escrito por falta de captura real — ver ' +
  'atlas/parse.ts e atlas/__fixtures__/README.md (Q-09).';

/**
 * RECUSA sempre, com o motivo acima. Falha alta e nunca silenciosa (R4): não
 * devolve `[]` (que o `BaseAdapter` traduziria num erro genérico de "nenhum
 * cenário"), não devolve cenário parcial e nunca inventa zero para candidato
 * ausente.
 */
export const extractAtlasScenarios = (_text: string): RawScenario[] => {
  throw new ParseError(ATLAS_NO_PARSABLE_SOURCE);
};
