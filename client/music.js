import lobbyTrack from './assets/DK-Water.mp3?url';
import gameTrack from './assets/DK-Racing.mp3?url';

export function setupMusic(audio, mute, slider, status) {
  const key = 'kottabos.music';
  let settings = {};
  try { settings = JSON.parse(localStorage.getItem(key)) || {}; } catch { /* Optional preference. */ }
  let muted = settings.muted === true;
  let volume = Number.isFinite(settings.volume) ? Math.max(0, Math.min(1, settings.volume)) : .35;
  let track = '';
  let context, gain;
  audio.loop = true;
  function apply() {
    mute.setAttribute('aria-pressed', String(muted));
    mute.textContent = muted ? 'Unmute music' : 'Mute music';
    slider.value = Math.round(volume * 100);
    audio.muted = muted;
    if (gain) gain.gain.value = volume;
    else audio.volume = volume;
  }
  function save() {
    apply();
    try { localStorage.setItem(key, JSON.stringify({ muted, volume })); } catch { /* Optional preference. */ }
  }
  function play() {
    if (!track || muted) return;
    const requested = track;
    audio.play().then(() => {
      if (requested === track) status.textContent = '';
    }).catch(() => {
      if (requested === track && audio.paused) status.textContent = 'Tap to play music';
    });
  }
  function activate() {
    // A gain node also supports volume adjustment on mobile browsers whose
    // media elements delegate volume to the device. Create it on a gesture.
    if (!context && window.AudioContext) {
      context = new AudioContext();
      gain = context.createGain();
      context.createMediaElementSource(audio).connect(gain).connect(context.destination);
      audio.volume = 1;
      apply();
    }
    if (context?.state === 'suspended') context.resume().catch(() => {});
    if (audio.paused) play();
  }
  window.addEventListener('click', activate);
  window.addEventListener('keydown', activate);
  mute.addEventListener('click', () => {
    muted = !muted;
    save();
    if (muted) audio.pause();
    else activate();
  });
  slider.addEventListener('input', () => { volume = Number(slider.value) / 100; save(); });
  apply();
  return function setPhase(phase) {
    const next = !phase ? '' : ['lobby', 'lengthVote', 'results'].includes(phase) ? lobbyTrack : gameTrack;
    if (next === track) return;
    track = next;
    audio.pause();
    status.textContent = '';
    if (track) { audio.src = track; play(); }
    else { audio.removeAttribute('src'); audio.load(); }
  };
}
