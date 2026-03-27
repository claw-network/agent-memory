import type { FileDiff } from "../types";

function buildLcsTable(left: string[], right: string[]): number[][] {
  const table = Array.from({ length: left.length + 1 }, () => Array<number>(right.length + 1).fill(0));

  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i][j] = left[i] === right[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  return table;
}

export function renderUnifiedDiff(path: string, before: string, after: string): FileDiff | null {
  if (before === after) {
    return null;
  }

  const left = before.split(/\r?\n/);
  const right = after.split(/\r?\n/);
  const table = buildLcsTable(left, right);

  const lines = [`--- ${path}`, `+++ ${path}`];
  let i = 0;
  let j = 0;

  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      lines.push(` ${left[i]}`);
      i += 1;
      j += 1;
      continue;
    }

    if (table[i + 1][j] >= table[i][j + 1]) {
      lines.push(`-${left[i]}`);
      i += 1;
    } else {
      lines.push(`+${right[j]}`);
      j += 1;
    }
  }

  while (i < left.length) {
    lines.push(`-${left[i]}`);
    i += 1;
  }

  while (j < right.length) {
    lines.push(`+${right[j]}`);
    j += 1;
  }

  return {
    path,
    diff: lines.join("\n"),
  };
}
