/**
 * Hachuras `<pattern>` por `color_slot` (docs/05 §2.1 regra 3, §8).
 *
 * Cor NUNCA é o único diferenciador: cada slot ganha também um padrão de linhas
 * (hachura). São 4 orientações rotacionadas, suficientes para distinguir as
 * séries por daltônicos e em impressão P&B. Como há 8 slots e 4 orientações, os
 * slots reusam orientações — mas nesse ponto a cor (que É estável por entidade)
 * já separa; o par (cor + hachura) é único o bastante para os 8.
 *
 * A hachura é derivada do slot (posição estável da entidade, docs/05 §2.1
 * regra 2), NUNCA da posição na lista. Reordenar não troca a hachura.
 *
 * Uso: renderizar `hachuraDefs(idPrefix)` uma vez dentro de `<defs>` do SVG e
 * referenciar `hachuraFill(idPrefix, slot)` como `fill` da área de banda.
 */

/** As 4 orientações rotacionadas (graus). Índice = slot % 4. */
const HACHURA_ANGLES = [0, 45, 90, 135] as const;

/** Espaçamento entre linhas da hachura, em px do espaço do padrão. */
const HACHURA_SPACING = 6;
/** Espessura do traço da hachura. */
const HACHURA_STROKE = 1;

export interface HachuraDef {
  /** id do `<pattern>` (referenciado por `url(#id)`). */
  id: string;
  /** Ângulo de rotação em graus. */
  angle: number;
  /** Índice da variante (0..3). */
  variant: number;
}

function patternId(idPrefix: string, slot: number): string {
  return `${idPrefix}-hachura-${slot}`;
}

/** Descreve as hachuras dos slots informados (1..8), sem duplicar por slot. */
export function hachuraDefsFor(idPrefix: string, slots: readonly number[]): HachuraDef[] {
  const unique = [...new Set(slots)].sort((a, b) => a - b);
  return unique.map((slot) => {
    const variant = (slot - 1) % HACHURA_ANGLES.length;
    return {
      id: patternId(idPrefix, slot),
      angle: HACHURA_ANGLES[variant] as number,
      variant,
    };
  });
}

/** Valor de `fill` que referencia a hachura do slot. */
export function hachuraFill(idPrefix: string, slot: number): string {
  return `url(#${patternId(idPrefix, slot)})`;
}

/** Parâmetros geométricos do `<pattern>` (usados pelo template Astro). */
export const HACHURA_GEOMETRY = {
  spacing: HACHURA_SPACING,
  stroke: HACHURA_STROKE,
} as const;
