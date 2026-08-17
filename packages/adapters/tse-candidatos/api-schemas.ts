/**
 * Fronteira HTTP do DivulgaCandContas: schemas Zod das respostas JSON reais
 * (CLAUDE.md — Zod em toda fronteira, tipo derivado por `z.infer`, nunca
 * declarado à mão em paralelo).
 *
 * O que a API REALMENTE devolve (capturado em 2026-08-16, ver `__fixtures__`):
 *
 * - A resposta é gigante e quase toda `null`. Descrevemos SÓ os campos que
 *   usamos, com `.passthrough()`, para que um campo novo do TSE não quebre o
 *   parser — mas um campo que usamos e sumiu quebre, alto e claro (R4).
 * - `sq_ELEICAO` vem como NÚMERO (20322002026). Cabe em `Number.MAX_SAFE_INTEGER`,
 *   mas todo id vira `string` na nossa fronteira: id é identificador, não
 *   grandeza, e não pode acabar em aritmética nem em notação científica.
 * - ARMADILHA REAL: na LISTAGEM, `fotoUrl` vem como string VAZIA e
 *   `fotoUrlPublicavel` vem `false` para TODAS as candidaturas. Os valores de
 *   verdade só aparecem no DETALHE (`/candidatura/buscar/.../candidato/{id}`).
 *   Por isso a listagem não é fonte de foto — é fonte de candidatura.
 * - `fotoUrlPublicavel` é a autorização do PRÓPRIO TSE para republicar a imagem.
 *   Só baixamos com `true`. É a trava que sustenta docs/08 §2.
 */

import { z } from 'zod';

/** Id do TSE: aceita número ou string na entrada, normaliza para string. */
const tseId = z
  .union([z.number().int(), z.string().min(1)])
  .transform((value) => (typeof value === 'number' ? String(value) : value));

/**
 * `GET /divulga/rest/v1/eleicao/eleicao-atual?idEleicao=0`
 *
 * Só lemos o bloco `eleicao`. O campo `ues` (27 UFs com cargos e diretórios)
 * é ignorado de propósito: não precisamos dele e ele é 90% do payload.
 */
export const eleicaoAtualSchema = z
  .object({
    eleicao: z
      .object({
        sq_ELEICAO: tseId,
        nr_ANO_REFERENCIA: z.number().int(),
        nm_ELEICAO: z.string(),
        tp_ABRANGENCIA: z.string(),
      })
      .passthrough(),
  })
  .passthrough();
export type EleicaoAtual = z.infer<typeof eleicaoAtualSchema>;

const partidoSchema = z
  .object({
    sigla: z.string().nullable(),
    numero: z.number().int().nullable(),
  })
  .passthrough();

const cargoSchema = z
  .object({
    codigo: z.number().int(),
    nome: z.string(),
  })
  .passthrough();

/**
 * Uma candidatura na LISTAGEM
 * `GET /divulga/rest/v1/candidatura/listar/{ano}/{ue}/{idEleicao}/{cargo}/candidatos`.
 *
 * `nomeUrna`/`nomeCompleto` vêm em CAIXA ALTA, com e sem acento conforme o
 * cadastro (ex.: 'FLAVIO NANTES BOLSONARO' sem acento, 'LUIZ INÁCIO LULA DA
 * SILVA' com). O casamento normaliza os dois lados — ver `matching.ts`.
 */
export const candidaturaListaSchema = z
  .object({
    id: tseId,
    nomeUrna: z.string().min(1),
    nomeCompleto: z.string().min(1),
    numero: z.number().int(),
    partido: partidoSchema,
    cargo: cargoSchema,
    descricaoSituacao: z.string().nullable(),
    descricaoTotalizacao: z.string().nullable(),
  })
  .passthrough();
export type CandidaturaLista = z.infer<typeof candidaturaListaSchema>;

export const listaCandidatosSchema = z
  .object({
    unidadeEleitoral: z.object({ sigla: z.string() }).passthrough(),
    cargo: cargoSchema,
    candidatos: z.array(candidaturaListaSchema),
  })
  .passthrough();
export type ListaCandidatos = z.infer<typeof listaCandidatosSchema>;

/**
 * DETALHE `GET /divulga/rest/v1/candidatura/buscar/{ano}/{ue}/{idEleicao}/candidato/{id}`.
 * É a ÚNICA resposta que traz `fotoUrl` preenchido e `fotoUrlPublicavel` honesto.
 *
 * `fotoUrl` é opcional/nullable porque candidatura sem foto entregue existe — e
 * nesse caso o resultado é `null` + alerta, nunca um palpite (R4).
 */
export const candidaturaDetalheSchema = z
  .object({
    id: tseId,
    nomeUrna: z.string().min(1),
    nomeCompleto: z.string().min(1),
    numero: z.number().int(),
    partido: partidoSchema,
    fotoUrl: z.string().nullable().optional(),
    fotoUrlPublicavel: z.boolean().nullable().optional(),
    fotoDataUltimaAtualizacao: z.union([z.string(), z.number()]).nullable().optional(),
  })
  .passthrough();
export type CandidaturaDetalhe = z.infer<typeof candidaturaDetalheSchema>;
