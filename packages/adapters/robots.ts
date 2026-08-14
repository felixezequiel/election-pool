/**
 * Parser e cache de `robots.txt` (docs/04 §6: "consultado e respeitado antes de
 * toda requisição, com cache de 24h"). Compartilhado por todos os adapters.
 *
 * Semântica (RFC 9309):
 * - Só grupos que casam nosso User-Agent (por token) ou o coringa `*` valem.
 *   O grupo mais específico (nosso token) tem precedência sobre `*`.
 * - `Allow`/`Disallow` casam por prefixo de path; a regra de MAIOR comprimento
 *   vence; em empate, `Allow` ganha (RFC 9309 §2.2.2).
 * - `Disallow:` vazio significa "permite tudo".
 * - Se o `robots.txt` responder 404 ou não puder ser buscado, o padrão é
 *   PERMITIR (RFC 9309 §2.3.1.4: "unavailable" ⇒ allow all). 5xx seria
 *   "unreachable" (negar), mas tratamos rede indisponível como allow para não
 *   travar o pipeline num ambiente sem saída; o rate limit e o UA continuam
 *   valendo de qualquer forma.
 */

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h (docs/04 §6)

/** Resposta mínima do fetch de robots que o parser precisa. */
export interface RobotsFetchResult {
  status: number;
  body: string;
}

export type RobotsFetcher = (robotsUrl: string) => Promise<RobotsFetchResult>;

interface Rule {
  allow: boolean;
  path: string;
}

interface Rules {
  rules: Rule[];
}

interface CacheEntry {
  rules: Rules;
  expiresAt: number;
}

const ALLOW_ALL: Rules = { rules: [] };

/** Token do nosso UA, para casar grupos `User-agent:` (case-insensitive). */
const UA_TOKEN = 'election-pool';

const parseRobotsTxt = (body: string): Rules => {
  const lines = body.split(/\r?\n/);
  // Agrupa por bloco de User-agent. Coletamos as regras dos grupos que se
  // aplicam a nós: o grupo do nosso token vence o coringa `*`.
  const groups: { agents: string[]; rules: Rule[] }[] = [];
  let current: { agents: string[]; rules: Rule[] } | null = null;
  let lastWasAgent = false;

  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (line.length === 0) continue;
    const sep = line.indexOf(':');
    if (sep === -1) continue;
    const field = line.slice(0, sep).trim().toLowerCase();
    const value = line.slice(sep + 1).trim();

    if (field === 'user-agent') {
      if (!lastWasAgent || current === null) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (current === null) continue;
    if (field === 'allow') {
      current.rules.push({ allow: true, path: value });
    } else if (field === 'disallow') {
      current.rules.push({ allow: false, path: value });
    }
  }

  const specific = groups.find((g) => g.agents.includes(UA_TOKEN));
  const wildcard = groups.find((g) => g.agents.includes('*'));
  const chosen = specific ?? wildcard;
  if (chosen === undefined) return ALLOW_ALL;
  // `Disallow:` vazio = permite tudo; descartamos regras de path vazio na negação.
  return { rules: chosen.rules.filter((r) => r.allow || r.path.length > 0) };
};

const isAllowedByRules = (rules: Rules, path: string): boolean => {
  let best: Rule | null = null;
  for (const rule of rules.rules) {
    if (rule.path.length === 0) continue;
    if (!path.startsWith(rule.path)) continue;
    if (best === null || rule.path.length > best.path.length) {
      best = rule;
    } else if (rule.path.length === best.path.length && rule.allow && !best.allow) {
      best = rule; // empate: Allow vence.
    }
  }
  return best === null ? true : best.allow;
};

/**
 * Guarda `robots.txt` por host com TTL de 24h e decide se um path é permitido.
 * Recebe o fetcher por injeção (o HTTP client em produção, um mock nos testes).
 * O relógio é injetável para permitir fake timers no teste do TTL.
 */
export class RobotsCache {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly fetcher: RobotsFetcher,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private async rulesFor(origin: string): Promise<Rules> {
    const cached = this.cache.get(origin);
    if (cached !== undefined && cached.expiresAt > this.now()) {
      return cached.rules;
    }
    let rules: Rules;
    try {
      const res = await this.fetcher(`${origin}/robots.txt`);
      // 4xx (incl. 404) ⇒ sem restrições. 2xx ⇒ parseia. Outros ⇒ allow (ver nota).
      rules = res.status >= 200 && res.status < 300 ? parseRobotsTxt(res.body) : ALLOW_ALL;
    } catch {
      rules = ALLOW_ALL;
    }
    this.cache.set(origin, { rules, expiresAt: this.now() + CACHE_TTL_MS });
    return rules;
  }

  /** `true` se o path do URL é permitido pelo `robots.txt` do host. */
  async isAllowed(targetUrl: string): Promise<boolean> {
    const url = new URL(targetUrl);
    const rules = await this.rulesFor(url.origin);
    return isAllowedByRules(rules, `${url.pathname}${url.search}`);
  }
}

export const __test = { parseRobotsTxt, isAllowedByRules };
