import chalk from 'chalk';

export const c = {
  brand: chalk.hex('#8B5CF6'),
  ok: chalk.green,
  warn: chalk.yellow,
  err: chalk.red,
  dim: chalk.dim,
  bold: chalk.bold,
  cyan: chalk.cyan,
  label: chalk.cyan.bold,
  muted: chalk.gray,
};

export const sym = {
  ok: c.ok('✔'),
  err: c.err('✖'),
  warn: c.warn('⚠'),
  info: c.cyan('›'),
  bullet: c.dim('·'),
  arrow: c.dim('→'),
};

export function header(title, subtitle) {
  const bar = c.brand('━'.repeat(Math.max(title.length + 4, 40)));
  const lines = [
    '',
    bar,
    `  ${c.brand.bold(title)}`,
  ];
  if (subtitle) lines.push(`  ${c.dim(subtitle)}`);
  lines.push(bar, '');
  return lines.join('\n');
}

export function step(n, total, label) {
  return `${c.dim(`[${n}/${total}]`)} ${c.bold(label)}`;
}
