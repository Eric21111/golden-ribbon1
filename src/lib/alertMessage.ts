/**
 * The message of a confirm / notice dialog as blocks: a line that starts with "- " is a bullet, a blank line is just a gap, anything
 * else is a paragraph. Lets a message be written as plain text ("Once you start:\n- a\n- b") and shown as a proper list.
 * Free of React so it can be unit-tested.
 */
export type AlertMessageBlock = { type: 'text'; text: string } | { type: 'bullet'; text: string };

export function parseAlertMessage(message: string): AlertMessageBlock[] {
  const blocks: AlertMessageBlock[] = [];
  for (const raw of message.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    blocks.push(line.startsWith('- ') ? { type: 'bullet', text: line.slice(2).trim() } : { type: 'text', text: line });
  }
  return blocks;
}
