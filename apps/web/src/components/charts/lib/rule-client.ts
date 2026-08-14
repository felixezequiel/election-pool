/**
 * Cliente da UncertaintyRule: reposiciona banda + marca central sem re-render,
 * na escala já embutida no SVG (data-domain-min/max/width). Usado pelo scrub do
 * LatentBandChart e pela transição de atualização (novo run). O CSS interpola x,
 * width e transform ⇒ a banda "escorrega" do valor antigo ao novo, sem pulo
 * (docs/05 §5.1, §6.2). Respeita prefers-reduced-motion via CSS (transition:
 * none).
 */

export interface RuleValues {
  mean: number;
  lo90: number;
  hi90: number;
}

const PAD_X = 2;

export function updateUncertaintyRule(svg: SVGElement, v: RuleValues): void {
  const dMin = Number(svg.getAttribute('data-domain-min') ?? '0');
  const dMax = Number(svg.getAttribute('data-domain-max') ?? '100');
  const width = Number(svg.getAttribute('data-width') ?? '220');
  const span = dMax - dMin || 1;
  const scale = (val: number): number => PAD_X + ((val - dMin) / span) * (width - 2 * PAD_X);

  const band = svg.querySelector<SVGRectElement>('[data-rule-band]');
  const center = svg.querySelector<SVGLineElement>('[data-rule-center]');
  const xLo = scale(v.lo90);
  const xHi = scale(v.hi90);
  const xMean = scale(v.mean);
  if (band) {
    band.setAttribute('x', String(xLo));
    band.setAttribute('width', String(Math.max(0, xHi - xLo)));
  }
  if (center) {
    center.setAttribute('x1', String(xMean));
    center.setAttribute('x2', String(xMean));
  }
}

/** Encontra a régua associada a um readout de candidato pelo id de destino. */
export function findRuleFor(root: ParentNode, candidateId: string): SVGElement | null {
  return root.querySelector<SVGElement>(`[data-rule-for="${CSS.escape(candidateId)}"]`);
}
