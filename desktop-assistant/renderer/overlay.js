const stage = document.querySelector('#stage');
const milo = document.querySelector('#milo');
const speech = document.querySelector('#speech');
let hideTimer;
let speechTimer;
let speakEnabled = true;

function closeAfterSpeech() {
  clearTimeout(hideTimer);
  const seconds = Math.max(4500, Math.min(14000, (speech.textContent.length / 10) * 1000));
  hideTimer = setTimeout(() => {
    speech.classList.remove('show');
    milo.classList.remove('visible');
    setTimeout(() => { speech.hidden = true; }, 400);
  }, seconds);
}

function say({ text, speak = true }) {
  if (!text) return;
  clearTimeout(hideTimer);
  clearTimeout(speechTimer);
  speech.textContent = text;
  speech.hidden = false;
  requestAnimationFrame(() => { milo.classList.add('visible'); speech.classList.add('show'); });
  if (speak && speakEnabled && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ml-IN';
    utterance.rate = 0.9;
    utterance.pitch = 1.03;
    utterance.onend = closeAfterSpeech;
    utterance.onerror = closeAfterSpeech;
    window.speechSynthesis.speak(utterance);
  } else closeAfterSpeech();
  speechTimer = setTimeout(closeAfterSpeech, 16000);
}

window.miloCompanion.onSettings(settings => { speakEnabled = settings.speak; });
window.miloCompanion.onSay(say);
