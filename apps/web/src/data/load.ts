/**
 * Costura de dados (data seam) — ponto ÚNICO por onde as páginas leem o
 * `data.json`. Importa o JSON em build time (sem fetch em runtime, docs/06 §1) e
 * VALIDA contra `publicDataSchema` (docs/03 §5). Se o artefato não bater com o
 * contrato, o build FALHA aqui — nunca serve dado inválido (R4).
 *
 * ── Como T-13 (RenderJob) pluga o dado real ────────────────────────────────
 * Hoje isto aponta para `./sample-data.json`, uma amostra COMPLETA e fictícia
 * (gerada por `scripts/gen-sample-data.mjs`). T-13 substitui a amostra pelo
 * `data.json` gerado de duas formas equivalentes, à escolha do pipeline:
 *   (a) sobrescrever `src/data/sample-data.json` com o artefato real antes do
 *       `astro build`; OU
 *   (b) redirecionar o import abaixo para o caminho do artefato publicado.
 * Em ambos os casos o contrato de validação permanece: `publicDataSchema.parse`.
 * Nenhuma página importa o JSON diretamente — todas passam por aqui.
 */
import { publicDataSchema, type PublicData } from '@election-pool/contracts/public-data';
import rawData from './sample-data.json';

export const data: PublicData = publicDataSchema.parse(rawData);
