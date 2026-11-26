// Short synthesized cues: no downloads and no other player's input in this path.
const tones = {
  jump: [280, 680, .13, 'sine', .10],
  duck: [390, 130, .11, 'triangle', .12],
  wind: [620, 900, .035, 'triangle', .06],
  move: [150, 85, .045, 'triangle', .035],
  pull: [200, 470, .10, 'triangle', .09],
  stun: [700, 190, .12, 'sine', .09],
  ding: [1040, 880, .24, 'sine', .13],
  death: [310, 55, .48, 'triangle', .15],
};

export class SoundEffects {
  constructor(button) {
    this.previous = null;
    this.lastStepAt = -Infinity;
    this.muted = false;
    try { this.muted = localStorage.getItem('kottabos.effects-muted') === 'true'; } catch { /* Optional. */ }
    const render = () => {
      button?.setAttribute('aria-pressed', String(this.muted));
      if (button) button.textContent = this.muted ? 'Unmute effects' : 'Mute effects';
    };
    button?.addEventListener('click', () => {
      this.muted = !this.muted;
      try { localStorage.setItem('kottabos.effects-muted', String(this.muted)); } catch { /* Optional. */ }
      render();
    });
    render();
    // Unlock on the same gesture as controls, before their bubbling listeners.
    for (const type of ['pointerdown', 'keydown']) window.addEventListener(type, () => this.activate(), { capture: true });
  }

  activate() {
    if (this.muted) return;
    try {
      if (!this.context && window.AudioContext) this.context = new window.AudioContext();
      if (this.context?.state === 'suspended') this.context.resume().catch(() => {});
    } catch { /* Audio is optional; gameplay remains available. */ }
  }

  play(name) {
    if (this.muted || document.hidden || this.context?.state !== 'running' || !tones[name]) return;
    const [start, end, duration, type, volume] = tones[name], at = this.context.currentTime;
    const oscillator = this.context.createOscillator(), gain = this.context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(start, at);
    oscillator.frequency.exponentialRampToValueAtTime(end, at + duration);
    gain.gain.setValueAtTime(.0001, at);
    gain.gain.exponentialRampToValueAtTime(volume, at + .006);
    gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
    oscillator.connect(gain).connect(this.context.destination);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    oscillator.start(at); oscillator.stop(at + duration);
  }

  movement(moving, now) {
    if (!moving) { this.lastStepAt = -Infinity; return; }
    if (now - this.lastStepAt < 240) return;
    this.lastStepAt = now;
    this.play('move');
  }

  observe(state, me, connected) {
    if (!connected || !me || !state) { this.previous = null; return; }
    const key = `${state.code}:${me.id}`;
    const dings = me.totalDings, eliminations = me.totalEliminations;
    const previous = this.previous;
    if (previous?.key === key) {
      if (dings > previous.dings) this.play('ding');
      if (eliminations > previous.eliminations) this.play('death');
    }
    this.previous = { key, dings, eliminations };
  }
}
