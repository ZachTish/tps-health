import { Modal, type App, type Scope } from 'obsidian';

/** A keyboard-dismiss gesture must not also discard the food logger. */
export class FoodInputModal extends Modal {
  private releaseKeyboardGuard: (() => void) | null = null;
  private lastInputBlur = -Infinity;

  constructor(app: App) {
    super(app);
    if (this.scope) {
      this.scope = new (this.scope.constructor as typeof Scope)(this.scope);
      this.scope.register([], 'Escape', () => {
        if (!this.dismissInput()) this.close();
        return false;
      });
    }
  }

  private activeInput(): HTMLElement | null {
    const active = this.contentEl?.ownerDocument?.activeElement as HTMLElement | null;
    return active && this.contentEl.contains(active)
      && active.matches('input:not([type=button]):not([type=checkbox]), textarea, [contenteditable=true]')
      ? active : null;
  }

  private dismissInput(): boolean {
    const input = this.activeInput();
    if (!input) return false;
    input.blur();
    this.lastInputBlur = Date.now();
    return true;
  }

  open(): void {
    super.open();
    const container = this.containerEl;
    if (!container?.addEventListener) return;
    const onBlur = (event: FocusEvent) => {
      if ((event.target as HTMLElement)?.matches?.('input, textarea, [contenteditable=true]')) {
        this.lastInputBlur = Date.now();
      }
    };
    const guard = (event: Event) => {
      const target = event.target as HTMLElement;
      if (!target?.classList?.contains('modal-bg')) return;
      if (this.dismissInput() || Date.now() - this.lastInputBlur < 400) {
        if (event.cancelable) event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    const events = ['pointerdown', 'mousedown', 'touchstart', 'click'];
    this.contentEl.addEventListener('focusout', onBlur);
    for (const event of events) container.addEventListener(event, guard, { capture: true, passive: false });
    this.releaseKeyboardGuard = () => {
      this.contentEl.removeEventListener('focusout', onBlur);
      for (const event of events) container.removeEventListener(event, guard, true);
    };
  }

  close(): void {
    this.releaseKeyboardGuard?.();
    this.releaseKeyboardGuard = null;
    super.close();
  }
}

/** Preserve the actual scrolling ancestors, not just modal-content. */
export function preserveFoodModalScroll(content: HTMLElement, update: () => void): void {
  const positions: Array<{ element: HTMLElement; top: number }> = [];
  for (let element: HTMLElement | null = content; element; element = element.parentElement) {
    if (element === content || element.scrollHeight > element.clientHeight) {
      positions.push({ element, top: element.scrollTop || 0 });
    }
  }
  update();
  for (const { element, top } of positions) element.scrollTop = top;
}
