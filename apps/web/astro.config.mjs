import { defineConfig } from 'astro/config';

// Site estático (docs/06 §1). Tema escuro é o padrão — garantido no nível do
// documento por <html data-theme="dark"> no Base.astro, não aqui. As páginas
// (/, /metodologia, /dados) são `.astro` puro com scripts hoisted (padrão de
// T-10/T-11); nenhuma integração de framework é necessária, então a config
// permanece mínima de propósito. Sem script de terceiros / analytics (docs/06 §7).
export default defineConfig({
  output: 'static',
  site: 'https://election-pool.example',
});
