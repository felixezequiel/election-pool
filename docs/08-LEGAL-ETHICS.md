# Restrições legais e éticas

> Nota: este documento organiza as restrições operacionais do projeto. Não é
> parecer jurídico. Antes de expor o site publicamente, vale consulta a advogado
> com prática em direito eleitoral e propriedade intelectual.

## 1. Lei 9.504/1997 e Res.-TSE 23.600/2019

O que se aplica a nós:

- Pesquisas eleitorais devem ser registradas no PesqEle **até 5 dias antes** da
  divulgação. Isso vale para quem realiza a pesquisa.
- Divulgar pesquisa não registrada sujeita a penalidade. Não realizamos pesquisa,
  mas divulgamos resultados — logo, **toda pesquisa exibida precisa ter registro
  válido e o número visível** (R6 do `CLAUDE.md`).
- Se um registro não for encontrado no PesqEle, a pesquisa **não entra no
  agregado**, mesmo que a imprensa a tenha divulgado.
- Os dados do PesqEle ficam públicos por 30 dias. Persistimos porque precisamos,
  e citamos a origem.

**Implicação de produto:** o `tse_id` não é metadado opcional. É a chave primária
do sistema (`docs/03` §2.3) e é elemento obrigatório de UI.

## 2. Direito autoral

Distinção que governa toda a ingestão:

| Item | Status | O que fazemos |
|---|---|---|
| Números de uma pesquisa | Fato | Extraímos, armazenamos, republicamos |
| Metadata (instituto, contratante, n, datas) | Fato | Idem |
| Texto da reportagem | Obra protegida | Nunca armazenamos como conteúdo servível, nunca republicamos |
| Gráfico/imagem do instituto ou veículo | Obra protegida | Nunca copiamos, nunca embutimos |
| Estrutura/curadoria de um agregador terceiro | Possivelmente protegida | Não copiamos seleção nem organização |

### 2.1 Regras operacionais

- `raw_documents` guarda o HTML/PDF original **apenas** como prova de proveniência,
  em disco, fora da árvore servida pelo nginx. Nunca exposto por rota, nunca
  incluído em `data.json`, nunca em backup público.
- Nenhum campo de `data.json` contém prosa de terceiros. Nem título de matéria,
  nem trecho, nem resumo.
- Referência à fonte é sempre **link**, nunca conteúdo.
- Nossos textos são originais. Não parafraseamos análise alheia.

Um teste (`no-third-party-prose.spec.ts`) percorre `data.json` e falha se qualquer
campo de string exceder 200 caracteres fora da allowlist de campos nossos
(`methodologyNotes`, `displayName` etc.).

## 3. Postura de crawler

Detalhes em `docs/04` §6. O princípio: **um crawler educado é um crawler que
sobrevive**. Toda regra ali existe para não sermos bloqueados e para não impor
custo a quem publica o dado.

Adicionalmente:

- Página `/metodologia` acessível pelo `User-Agent`, explicando quem somos e como
  parar de ser rastreado
- Pedido de remoção por um instituto é atendido em até 48h, sem discussão. O
  agregado passa a exibir aquele instituto como "fonte removida a pedido" — o que,
  ironicamente, é informação.

## 4. Ética editorial

O projeto tem um risco que não é jurídico: **o autor tem opinião política e está
construindo a ferramenta que mede política**. As defesas:

1. **Modelo cego a identidade.** `packages/model` não pode referenciar candidato
   ou espectro (R2, testado em CI). Se o modelo precisasse saber quem é quem para
   funcionar, ele estaria errado.
2. **Pré-registro de mudanças.** Alterar o modelo exige commit com justificativa
   escrita antes de ver a nova saída. O histórico de git é a evidência.
3. **Dado e código públicos.** Quem discordar do modelo roda o próprio sobre o
   mesmo `data.json`. Isso protege o leitor e protege o autor de si mesmo.
4. **Nenhuma opinião no produto.** O site descreve propriedades mensuráveis. Não
   avalia candidato, não avalia instituto em termos morais, não recomenda voto.
5. **Diagnóstico não é acusação.** Todo indicador da §6 de `docs/01` é publicado
   junto da sua explicação inocente, no mesmo peso visual (`docs/06` §5).

## 5. Vocabulário

Proibido em qualquer texto do site, commit, ou nome de variável:

`comprada` · `fraude` · `manipulada` · `mentirosa` · `militante` ·
`encomendada` (no sentido pejorativo) · `revela` · `crava` · `dispara` ·
`desmonta` · qualquer adjetivo avaliativo aplicado a candidato

Aprovado:

`registrada e não divulgada` · `dispersão abaixo do esperado` ·
`consistentemente acima do consenso` · `contratada por` ·
`house effect estimado em` · `não estimável`

## 6. Se der errado

Se o projeto publicar um número errado:

1. Corrigir em até 1h ou tirar do ar
2. Registrar em `docs/CORRECTIONS.md`: o que estava errado, por quanto tempo
   ficou no ar, a causa raiz, o que mudou para não repetir
3. Publicar a correção na própria página, com a mesma proeminência do dado errado,
   por no mínimo 7 dias

Um agregador que esconde o próprio erro não tem o que ensinar sobre viés alheio.
