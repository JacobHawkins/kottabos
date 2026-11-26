import waterTrack from './assets/DK-Water.mp3?url';
import racingTrack from './assets/DK-Racing.mp3?url';

const TRACKS = { water: waterTrack, racing: racingTrack };
const SONG_COOKIE = 'kottabos.song';

export function setupMusic(audio, mute, slider, status, select) {
  const key = 'kottabos.music';
  let settings = {};
  try { settings = JSON.parse(localStorage.getItem(key)) || {}; } catch { /* Optional preference. */ }
  let muted = settings.muted === true;
  let volume = Number.isFinite(settings.volume) ? Math.max(0, Math.min(1, settings.volume)) : .35;
  let song = 'water';
  try {
    const saved = document.cookie.split(';').map(c => c.trim()).find(c => c.startsWith(`${SONG_COOKIE}=`))?.split('=')[1];
    if (Object.hasOwn(TRACKS, saved)) song = saved;
  } catch { /* Optional preference. */ }
  select.value = song;
  let track = '', phase = '', generation = 0;
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
    if (!track || muted || phase !== 'lobby' || document.hidden) return;
    const request = generation;
    audio.play().then(() => {
      if (phase !== 'lobby' || muted || document.hidden) audio.pause();
      if (request === generation) status.textContent = '';
    }).catch(() => {
      if (request === generation && track && !muted && audio.paused) status.textContent = 'Tap to play music';
    });
  }
  function activate() {
    if (phase !== 'lobby' || muted) return;
    // Gain supports volume on mobile browsers that delegate media volume to the device.
    try {
      if (!context && window.AudioContext) {
        context = new window.AudioContext();
        gain = context.createGain();
        context.createMediaElementSource(audio).connect(gain).connect(context.destination);
        audio.volume = 1;
        apply();
      }
      if (context?.state === 'suspended') context.resume().catch(() => {});
    } catch { /* Fall back to media-element volume when audio graphs are unavailable. */ }
    if (audio.paused) play();
  }
  function update() {
    const next = phase === 'lobby' ? TRACKS[song] : '';
    if (next === track) return;
    generation++;
    track = next;
    audio.pause();
    status.textContent = '';
    if (track) { audio.src = track; play(); }
    else { audio.removeAttribute('src'); audio.load(); }
  }
  window.addEventListener('click', activate);
  window.addEventListener('keydown', activate);
  document.addEventListener('visibilitychange', () => { if (document.hidden) audio.pause(); else play(); });
  window.addEventListener('pagehide', () => audio.pause());
  mute.addEventListener('click', () => {
    muted = !muted;
    save();
    if (muted) { audio.pause(); status.textContent = ''; }
    else activate();
  });
  slider.addEventListener('input', () => { volume = Number(slider.value) / 100; save(); });
  select.addEventListener('change', () => {
    if (!Object.hasOwn(TRACKS, select.value)) return;
    song = select.value;
    try {
      document.cookie = `${SONG_COOKIE}=${song}; Max-Age=31536000; Path=/; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
    } catch { /* Optional preference. */ }
    update();
  });
  apply();
  return function setPhase(value) { phase = value; update(); };
}
