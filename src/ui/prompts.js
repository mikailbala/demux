import {
  confirm as inqConfirm,
  input as inqInput,
  select as inqSelect,
  checkbox as inqCheckbox,
} from '@inquirer/prompts';
import { c } from './theme.js';

export async function confirm(message, { default: def = false } = {}) {
  return inqConfirm({ message, default: def });
}

export async function ask(message, { default: def, validate } = {}) {
  return inqInput({ message, default: def, validate });
}

export async function selectOne(message, choices, { default: def } = {}) {
  return inqSelect({ message, choices, default: def });
}

export async function selectMany(message, choices, { required = false } = {}) {
  return inqCheckbox({ message, choices, required });
}

export function divider(label) {
  if (!label) return c.muted('─'.repeat(60));
  const pad = c.muted('─'.repeat(2));
  return `${pad} ${c.bold(label)} ${c.muted('─'.repeat(Math.max(0, 56 - label.length)))}`;
}
