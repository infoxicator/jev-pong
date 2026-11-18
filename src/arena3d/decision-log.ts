import { TACTIC_LABELS } from '../benchmark';
import type { TacticalLogEntry } from '../live-tactics';
import type { Side } from '../physics';

export function createDecisionLog(list: HTMLOListElement, empty: HTMLElement) {
  let previous: readonly TacticalLogEntry[] | undefined;
  return (entries: readonly TacticalLogEntry[], names: Record<Side, string>) => {
    if (entries === previous) return;
    previous = entries;
    const rows = [...entries].reverse().map(entry => {
      const row = document.createElement('li');
      row.className = `decision-row ${entry.side}`;
      const player = document.createElement('strong');
      player.className = 'decision-player';
      player.textContent = names[entry.side];
      const choice = document.createElement('div');
      choice.className = 'decision-choice';
      const shot = document.createElement('span');
      shot.textContent = entry.shot ? TACTIC_LABELS[entry.shot] : 'No return';
      choice.append(shot);
      if (entry.reason) {
        const reason = document.createElement('small');
        reason.textContent = entry.reason;
        choice.append(reason);
      }
      const source = document.createElement('span');
      source.className = 'decision-source';
      source.textContent = entry.status === 'unreachable' ? 'Unreachable'
        : entry.status === 'fallback' ? 'Local fallback'
        : entry.source === 'mock' ? 'MOCK / HEURISTIC'
        : entry.source === 'scripted' ? 'Scripted' : 'Live decision';
      row.append(player, choice, source);
      if (entry.ms !== undefined && entry.source !== 'mock') {
        const time = document.createElement('span');
        time.className = 'decision-time';
        time.textContent = `${entry.ms} ms`;
        row.append(time);
      }
      return row;
    });
    const scrollTop = list.scrollTop;
    list.replaceChildren(...rows);
    list.hidden = entries.length === 0;
    empty.hidden = entries.length > 0;
    list.scrollTop = scrollTop;
  };
}
