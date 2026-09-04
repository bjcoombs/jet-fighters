// The mute button, shared by both pages.

/** The mute control's state, as the toggle button sees it. */
export interface MuteControl {
  isMuted(): boolean;
  setMuted(muted: boolean): void;
}

/**
 * A small mute toggle for the page's top-left corner, and the M key beside it.
 *
 * It silences the browser's output, not the machine: the ROM keeps toggling the
 * pin and the board keeps recording the edges, exactly as a real unit with its
 * piezo disconnected would.
 */
export function buildMuteToggle(control: MuteControl): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'jf-mute';
  btn.style.cssText =
    'position:absolute;top:8px;left:8px;z-index:10;width:28px;height:28px;' +
    'border-radius:50%;border:1px solid rgba(255,255,255,0.4);' +
    'background:rgba(0,0,0,0.55);color:#eee;font-size:15px;line-height:1;cursor:pointer;' +
    'font-family:system-ui,sans-serif;';

  const sync = (): void => {
    const muted = control.isMuted();
    btn.textContent = muted ? '\u{1F507}' : '\u{1F50A}'; // muted / speaker
    btn.setAttribute('aria-label', muted ? 'Unmute audio' : 'Mute audio');
    btn.setAttribute('aria-pressed', String(muted));
  };

  const toggle = (): void => {
    control.setMuted(!control.isMuted());
    sync();
  };

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    toggle();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'm' || e.key === 'M') {
      e.preventDefault();
      toggle();
    }
  });

  sync();
  return btn;
}
