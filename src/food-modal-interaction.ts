import { Modal, type App, type Scope } from 'obsidian';

/** Food entry closes only through its X or an explicit completed/navigation action. */
export class FoodInputModal extends Modal {
  private releaseKeyboardGuard: (() => void) | null = null;

  constructor(app: App) {
    super(app);
    if (this.scope) {
      this.scope = new (this.scope.constructor as typeof Scope)(this.scope);
      this.scope.register([], 'Escape', () => {
        this.dismissInput();
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
    return true;
  }

  open(): void {
    super.open();
    const container = this.containerEl;
    if (!container?.addEventListener) return;
    const closeButton = container.querySelector?.('.modal-close-button, .modal-header-button:has(.lucide-x)') as HTMLElement | null;
    closeButton?.setAttribute('role', 'button');
    closeButton?.setAttribute('tabindex', '0');
    closeButton?.setAttribute('aria-label', 'Close food logger');
    const guard = (event: Event) => {
      const target = event.target as HTMLElement;
      if (closeButton && (target === closeButton || closeButton.contains(target))) {
        if (event.type !== 'click') return;
        event.preventDefault();
        event.stopImmediatePropagation();
        this.closeFromAction();
        return;
      }
      if (!target?.classList?.contains('modal-bg') && target !== container) return;
      this.dismissInput();
      if (event.cancelable) event.preventDefault();
      event.stopImmediatePropagation();
    };
    const closeKey = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      this.closeFromAction();
    };
    const events = ['pointerdown', 'mousedown', 'touchstart', 'click'];
    for (const event of events) container.addEventListener(event, guard, { capture: true, passive: false });
    closeButton?.addEventListener('keydown', closeKey);
    this.releaseKeyboardGuard = () => {
      for (const event of events) container.removeEventListener(event, guard, true);
      closeButton?.removeEventListener('keydown', closeKey);
    };
  }

  close(): void {
    this.dismissInput();
  }

  protected closeFromAction(): void {
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
