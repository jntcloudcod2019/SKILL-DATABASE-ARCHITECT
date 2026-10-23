import { findEntity, type Issue } from '@dbarchitect/core';
import { issue, persistent, type Rule } from '../rule.ts';
import { accessPaths, covered } from './indexes.ts';

export const performanceRules: Rule[] = [
  {
    id: 'P001',
    category: 'performance',
    description: 'Consultas conhecidas sem índice de suporte e padrões de carregamento.',
    run(model) {
      const out: Issue[] = [];
      for (const q of model.queries) {
        const e = findEntity(model, q.entity);
        if (!e) continue;
        const paths = accessPaths(model, e);
        const cols = [...q.filters];
        const target = { kind: 'query', id: q.id };
        if (cols.length && !covered(paths, cols))
          out.push(
            issue(this, 'performance', `${q.id}:idx`, {
              message: `Consulta "${q.name}" filtra ${e.name} por ${cols.join(', ')} sem índice que a atenda`,
              target,
              rationale:
                'Sem índice cujo prefixo cubra os filtros, o banco tende a varrer a tabela. O custo real depende do volume, que não foi medido.',
              recommendation: `Considere índice em ${e.name}(${[...cols, ...q.orderBy.filter((o) => !cols.includes(o))].join(', ')})${e.estimatedRows ? ` (volume estimado informado: ${e.estimatedRows} linhas)` : '; informe o volume estimado para priorizar'}.`,
            }),
          );
        if (q.pagination === 'offset' && (e.estimatedRows ?? 0) > 100_000)
          out.push(
            issue(this, 'performance', `${q.id}:offset`, {
              message: `Consulta "${q.name}" usa paginação por OFFSET em tabela com ~${e.estimatedRows} linhas`,
              target,
              rationale: 'OFFSET precisa ler e descartar as linhas anteriores; páginas profundas ficam progressivamente lentas.',
              recommendation: 'Avalie paginação por chave (keyset) com índice na ordenação.',
            }),
          );
        if (q.orderBy.length && cols.length && !paths.some((p) => [...cols, ...q.orderBy].every((c, i) => p[i] === c)) && covered(paths, cols))
          out.push(
            issue(this, 'suggestion', `${q.id}:order`, {
              message: `Consulta "${q.name}": ordenação ${q.orderBy.join(', ')} não é atendida pelo índice dos filtros`,
              target,
              rationale: 'O banco precisará ordenar o resultado em memória/disco.',
              recommendation: 'Um índice composto (filtros, ordenação) elimina a ordenação extra, se a frequência justificar.',
            }),
          );
      }
      return out;
    },
  },
  {
    id: 'P002',
    category: 'performance',
    description: 'Chaves primárias e tamanhos que afetam o desempenho em tabelas volumosas.',
    run(model) {
      const out: Issue[] = [];
      for (const e of persistent(model)) {
        const pk = e.attributes.filter((a) => a.primaryKey);
        if (pk.length === 1 && pk[0].domainType === 'uuid' && pk[0].generated === 'uuid' && (e.estimatedRows ?? 0) > 1_000_000)
          out.push(
            issue(this, 'performance', `${e.id}:uuid`, {
              message: `${e.name}: PK UUID aleatório em tabela de ~${e.estimatedRows} linhas`,
              target: { kind: 'entity', id: e.id },
              rationale: 'UUIDs aleatórios fragmentam índices clusterizados/B-tree e aumentam escrita aleatória.',
              recommendation: 'Considere UUID ordenável por tempo (v7/ULID) ou chave sequencial, conforme o requisito de exposição do ID.',
            }),
          );
        if (e.attributes.length > 40)
          out.push(
            issue(this, 'suggestion', `${e.id}:wide`, {
              message: `${e.name} tem ${e.attributes.length} atributos`,
              target: { kind: 'entity', id: e.id },
              rationale: 'Tabelas muito largas costumam misturar responsabilidades.',
              recommendation: 'Revise se há grupos de campos com ciclo de vida próprio que merecem outra entidade.',
            }),
          );
      }
      return out;
    },
  },
];
