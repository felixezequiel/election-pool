# Fixtures — DivulgaCandContas (TSE)

Capturas **reais** do serviço público do TSE, feitas em **2026-08-16** (America/Sao_Paulo),
com o `User-Agent` do projeto. Nenhum arquivo aqui foi editado à mão além do recorte
descrito abaixo.

## Como a API foi descoberta

O `divulgacandcontas.tse.jus.br/divulga/` é um SPA Angular. Não existe documentação
pública dos endpoints, então a rota veio do próprio bundle do TSE:

```sh
curl -s https://divulgacandcontas.tse.jus.br/divulga/ | grep -oE 'src="[^"]*\.js"'
curl -s https://divulgacandcontas.tse.jus.br/divulga/main.<hash>.js \
  | grep -oE '"[^"]*rest/v1[^"]*"'
```

O `CandidaturaService` (chunk lazy do módulo `CandidatosModule`) define:

```
GET /divulga/rest/v1/candidatura/listar/{ano}/{uf}/{eleicao}/{cargo}/candidatos
GET /divulga/rest/v1/candidatura/buscar/{ano}/{sgUe}/{eleicao}/candidato/{idCandidato}
GET /divulga/rest/v1/candidatura/cargos?ano={ano}
GET /divulga/rest/v1/eleicao/eleicao-atual?idEleicao=0
```

A rota pública da candidatura (usada em `photoSourceUrl`) também veio do bundle:
`#/candidato/:regiao/:uf/:eleicaoID/:candidatoID/:ano/:sgUe` (hash routing).

## Arquivos

| Arquivo | Endpoint | Observação |
|---|---|---|
| `eleicao-atual.json` | `/eleicao/eleicao-atual?idEleicao=0` | **Recorte**: removido o array `ues` (27 UFs × cargos × diretórios, ~200 KB que o parser não lê). Os campos preservados são byte-idênticos à captura. |
| `candidatos-presidente-2026.json` | `/candidatura/listar/2026/BR/20322002026/1/candidatos` | Captura **integral**, 13 candidaturas. Só a indentação foi passada pelo Prettier do repo (`pnpm lint` cobre `**/*.json`); nenhum valor foi tocado. |
| `candidato-detalhe-280002542548.json` | `/candidatura/buscar/2026/BR/20322002026/candidato/280002542548` | Captura **integral** de uma candidatura. |

## O que a API real fez de diferente do esperado

1. **`fotoUrl` não existe na listagem.** Nas 13 candidaturas da lista, `fotoUrl` vem
   `null` e `fotoUrlPublicavel` vem `false`. Quem confia na listagem
   conclui que ninguém tem foto. Os valores verdadeiros só aparecem no **detalhe**,
   um GET por candidatura — onde as 13 têm `fotoUrlPublicavel: true`.
2. **`Content-Type` da imagem mente.** O download devolveu
   `Content-Type: image/png` e `Content-Disposition: filename=... .jpg` para bytes
   que começam com `FF D8 FF` (JPEG). Por isso `image.ts` decide o formato pelos
   bytes, nunca pelo cabeçalho.
3. **Sem `ETag` e sem `Last-Modified`** no endpoint da imagem — só
   `Cache-Control: max-age=240`. O conditional GET continua sendo enviado, mas a
   detecção de troca de foto depende do `sha256` dos bytes.
4. **`robots.txt` responde HTTP 403** com uma página HTML de erro do TSE. Pela
   RFC 9309 e pela política de `packages/adapters/robots.ts`, resposta não-2xx é
   tratada como "sem restrições" — o rate limit de 1 req/10s e o `User-Agent`
   identificável continuam valendo.
5. **`sq_ELEICAO` vem como número** (`20322002026`), não string.
6. O endpoint `candidatoscomvicessuplentes` devolve lista **vazia** para
   Presidente/2026, então não serve de atalho para evitar os GETs de detalhe.

## Foto real baixada na investigação (não versionada)

```
GET https://divulgacandcontas.tse.jus.br/divulga/rest/arquivo/img/20322002026/280002542548/BR
HTTP 200 · 6.621 bytes · JPEG 161x225 · sha256
7355fb81cb690d57fe915539390218a85cc5710e5ccf98de01df167e7ccfefc4
```

A imagem **não** é versionada como fixture: publicar a foto de uma pessoa dentro do
repositório de código não é necessário para testar nada. Os testes de `image.ts`
constroem JPEG/PNG sintéticos mínimos, que exercitam exatamente o mesmo caminho de
bytes (magic number + leitura de dimensão).
