import { Directive, HostListener } from '@angular/core';

type SwipeAxis = 'x' | 'y';

type SwipeGesture = {
  axis: SwipeAxis;
  panel: HTMLElement;
  scrim: HTMLElement;
  pointerId: number;
  startX: number;
  startY: number;
  startedAt: number;
  distance: number;
};

@Directive({
  selector: '[appSwipeCerrar]',
  standalone: true,
})
export class SwipeCerrarDirective {
  private gesture: SwipeGesture | null = null;

  @HostListener('document:pointerdown', ['$event'])
  onPointerDown(event: PointerEvent): void {
    if (window.innerWidth > 760 || !event.isPrimary || event.button !== 0) return;

    const target = event.target instanceof Element ? event.target : null;
    const handle = target?.closest<HTMLElement>(
      '.drawer-head, .modal-head, .casos-drawer-cabeza, .fusion-cabecera, .alta-cabecera, [data-swipe-handle]',
    );
    if (
      !target ||
      !handle ||
      target.closest('button, a, input, select, textarea, [contenteditable="true"]')
    ) {
      return;
    }

    const scrim = handle.closest<HTMLElement>(
      '.drawer-scrim, .modal-scrim, .casos-drawer-scrim, .la-scrim, .fusion-scrim, .alta-scrim',
    );
    const panel = handle.closest<HTMLElement>(
      '.drawer, .modal, .casos-drawer, .la, .fusion-modal, .alta-modal, [role="dialog"]',
    );
    if (!scrim || !panel || scrim.getAttribute('aria-hidden') === 'true') return;

    this.gesture = {
      axis: panel.matches('.modal, .la, .fusion-modal, .alta-modal') ? 'y' : 'x',
      panel,
      scrim,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startedAt: performance.now(),
      distance: 0,
    };
    panel.classList.add('is-swipe-active');
  }

  @HostListener('document:pointermove', ['$event'])
  onPointerMove(event: PointerEvent): void {
    const gesture = this.gesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;

    const delta =
      gesture.axis === 'x' ? event.clientX - gesture.startX : event.clientY - gesture.startY;
    if (delta <= 0) return;

    event.preventDefault();
    gesture.distance = delta;
    gesture.panel.style.translate = gesture.axis === 'x' ? `${delta}px 0` : `0 ${delta}px`;
    gesture.scrim.style.opacity = String(Math.max(0, 1 - delta / (window.innerWidth * 0.9)));
  }

  @HostListener('document:pointerup', ['$event'])
  @HostListener('document:pointercancel', ['$event'])
  onPointerEnd(event: PointerEvent): void {
    const gesture = this.gesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    this.gesture = null;

    const elapsed = Math.max(1, performance.now() - gesture.startedAt);
    const shouldClose =
      gesture.distance >= 88 || (gesture.distance >= 32 && gesture.distance / elapsed >= 0.62);
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 220;

    gesture.panel.style.transition = `translate ${duration}ms cubic-bezier(.2,.75,.25,1)`;
    gesture.scrim.style.transition = `opacity ${duration}ms ease`;

    if (!shouldClose) {
      gesture.panel.style.translate = '0 0';
      gesture.scrim.style.opacity = '';
      window.setTimeout(() => this.resetGestureStyles(gesture), duration + 30);
      return;
    }

    const bounds = gesture.panel.getBoundingClientRect();
    const exitDistance =
      gesture.axis === 'x'
        ? Math.max(window.innerWidth, bounds.width) + gesture.distance
        : Math.max(window.innerHeight, bounds.height) + gesture.distance;
    gesture.panel.style.translate =
      gesture.axis === 'x' ? `${exitDistance}px 0` : `0 ${exitDistance}px`;
    gesture.scrim.style.opacity = '0';

    window.setTimeout(() => {
      const closeButton = gesture.panel.querySelector<HTMLButtonElement>(
        'button[aria-label*="cerrar" i]',
      );
      if (closeButton && !closeButton.disabled) {
        closeButton.click();
        window.setTimeout(() => this.resetGestureStyles(gesture), 32);
        return;
      }

      gesture.scrim.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      window.setTimeout(() => {
        if (gesture.scrim.isConnected) {
          gesture.scrim.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }
        this.resetGestureStyles(gesture);
      }, 32);
    }, duration);
  }

  private resetGestureStyles(gesture: SwipeGesture): void {
    gesture.panel.classList.remove('is-swipe-active');
    gesture.panel.style.translate = '';
    gesture.panel.style.transition = '';
    gesture.scrim.style.opacity = '';
    gesture.scrim.style.transition = '';
  }
}
