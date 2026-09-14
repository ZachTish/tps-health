/** Claim only the native New action belonging to this exact Base, including embedded instances. */
export function claimMacrosBaseNew(event: MouseEvent | KeyboardEvent, container: HTMLElement, create: () => void): boolean {
  if (event.type === 'keydown' && !['Enter', ' '].includes((event as KeyboardEvent).key)) return false;
  if (event.type === 'click' && (event as MouseEvent).button !== 0) return false;
  const target = event.target as Element | null;
  if (!container.isConnected || !target?.closest) return false;
  const action = target.closest('.bases-toolbar-new-item-menu');
  const owner = action?.closest('.bases-header')?.parentElement;
  if (!owner || owner !== container.parentElement || !container.getClientRects().length) return false;
  event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
  create();
  return true;
}
