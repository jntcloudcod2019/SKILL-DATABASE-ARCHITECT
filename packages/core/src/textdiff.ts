/** Unified-style line diff (LCS). Good enough for reviewing generated files; not meant for huge inputs. */
export function unifiedDiff(oldText: string, newText: string, path: string): string {
  const a = oldText ? oldText.split('\n') : [];
  const b = newText.split('\n');
  // shortcut: O(n*m) table; generated artifacts are small. Upgrade to Myers if files exceed ~5k lines.
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const lines: string[] = [`--- ${oldText ? 'a/' + path : '/dev/null'}`, `+++ b/${path}`];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) {
      lines.push(` ${a[i]}`);
      i++;
      j++;
    } else if (j < m && (i >= n || lcs[i][j + 1] >= lcs[i + 1][j])) {
      lines.push(`+${b[j++]}`);
    } else {
      lines.push(`-${a[i++]}`);
    }
  }
  return lines.join('\n');
}
