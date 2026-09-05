// The small label that follows the pointer over a part. The rest of the page's
// controls are the dock (dock.ts).

export function buildTooltip(): { el: HTMLElement; show(text: string, x: number, y: number): void; hide(): void } {
  const el = document.createElement('div');
  el.className = 'jf-tooltip';
  el.hidden = true;
  return {
    el,
    show(text, x, y) {
      el.textContent = text;
      el.style.left = `${x + 14}px`;
      el.style.top = `${y + 14}px`;
      el.hidden = false;
    },
    hide() {
      el.hidden = true;
    },
  };
}
